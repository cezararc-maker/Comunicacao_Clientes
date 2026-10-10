import os
import hmac
import re
import io
import csv
import sqlite3
from pathlib import Path
from contextlib import contextmanager
from flask import Flask, request, jsonify, send_from_directory
from openpyxl import load_workbook
from contact_import import phone_key, parse_csv, parse_vcard, inspect_contacts

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "dados"
DATA.mkdir(exist_ok=True)
DB = DATA / "comunicacao.db"
app = Flask(__name__, static_folder="static", static_url_path="/static")
app.json.ensure_ascii = False

@contextmanager
def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        with con:
            yield con
    finally:
        con.close()

def init_db():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS empresas (
          id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE,
          nome TEXT NOT NULL, tipo TEXT NOT NULL,
          documento TEXT NOT NULL,
          UNIQUE(tipo, documento)
        );
        CREATE TABLE IF NOT EXISTS contatos (
          id INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS vinculos (
          empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          contato_id INTEGER NOT NULL REFERENCES contatos(id) ON DELETE CASCADE,
          funcao TEXT NOT NULL DEFAULT '',
          PRIMARY KEY(empresa_id, contato_id)
        );
        """)

def digits(s):
    return re.sub(r"\D", "", str(s or ""))

def normalize_company(data):
    codigo = str(data.get("codigo", "")).strip()
    nome = str(data.get("nome", "")).strip()
    tipo = str(data.get("tipo", "")).strip().upper()
    documento = digits(data.get("documento", ""))
    if not codigo or not nome or not documento or tipo not in ("CNPJ", "CPF", "CAEPF", "CEI"):
        raise ValueError("Preencha código, nome, tipo (CNPJ/CPF/CAEPF/CEI) e documento.")
    lengths = {"CNPJ": 14, "CPF": 11, "CAEPF": 14, "CEI": 12}
    if len(documento) != lengths[tipo]:
        raise ValueError(f"{tipo} deve conter {lengths[tipo]} dígitos.")
    return {"codigo":codigo, "nome":nome, "tipo":tipo, "documento":documento}

def company_status(db, item):
    by_code = db.execute("SELECT * FROM empresas WHERE codigo=?", (item["codigo"],)).fetchone()
    by_doc = db.execute("SELECT * FROM empresas WHERE tipo=? AND documento=?", (item["tipo"],item["documento"])).fetchone()
    if (by_code and by_doc and by_code["id"] != by_doc["id"]) or (by_code and (by_code["tipo"],by_code["documento"]) != (item["tipo"],item["documento"])) or (by_doc and by_doc["codigo"] != item["codigo"]):
        return "conflito", "Código ou documento associado a outra empresa."
    if by_code or by_doc:
        return "atualizar", "Cadastro existente: nome será atualizado."
    return "novo", "Novo cadastro."

@app.get("/")
def home():
    return send_from_directory(ROOT / "static", "index.html")

@app.get("/api/empresas")
def empresas():
    with connect() as db:
        return jsonify([dict(r) for r in db.execute("SELECT * FROM empresas ORDER BY nome")])

@app.post("/api/empresas")
def criar_empresa():
    try:
        item = normalize_company(request.get_json(force=True))
        with connect() as db:
            status, info = company_status(db, item)
            if status == "conflito":
                return jsonify(erro=info), 409
            if status == "atualizar":
                return jsonify(erro="Empresa já cadastrada. Utilize a importação para atualizar seu nome."), 409
            db.execute("INSERT INTO empresas(codigo,nome,tipo,documento) VALUES (:codigo,:nome,:tipo,:documento)", item)
        return jsonify(ok=True), 201
    except ValueError as e:
        return jsonify(erro=str(e)), 400

@app.get("/api/contatos")
def contatos():
    with connect() as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM contatos ORDER BY nome")]
        for row in rows:
            row["empresas"] = [dict(r) for r in db.execute("""
                SELECT e.id,e.codigo,e.nome,e.tipo,e.documento,v.funcao
                FROM empresas e JOIN vinculos v ON v.empresa_id=e.id
                WHERE v.contato_id=? ORDER BY e.nome""", (row["id"],))]
        return jsonify(rows)

@app.post("/api/contatos")
def criar_contato():
    item = request.get_json(force=True)
    nome = str(item.get("nome","")).strip()
    try:
        telefone = phone_key(item.get("telefone"))
    except ValueError as exc:
        return jsonify(erro=str(exc)), 400
    if not nome or len(nome) > 200 or len(telefone) < 10 or len(telefone) > 15:
        return jsonify(erro="Informe nome com até 200 caracteres e telefone com 10 a 15 dígitos."), 400
    try:
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if any(r['status'] == 'existente' for r in inspect_contacts(db, [{'nome': nome, 'telefone': '+' + telefone}])):
                return jsonify(erro="Telefone já cadastrado. Vincule a empresa ao contato existente."), 409
            db.execute("INSERT INTO contatos(nome,telefone) VALUES (?,?)", (nome,'+' + telefone))
        return jsonify(ok=True), 201
    except sqlite3.IntegrityError:
        return jsonify(erro="Telefone já cadastrado. Vincule a empresa ao contato existente."), 409

@app.post("/api/vinculos")
def vincular():
    body = request.get_json(force=True)
    try:
        with connect() as db:
            db.execute("INSERT INTO vinculos(contato_id,empresa_id,funcao) VALUES (?,?,?) ON CONFLICT(contato_id,empresa_id) DO UPDATE SET funcao=excluded.funcao",
                       (int(body["contato_id"]),int(body["empresa_id"]),str(body.get("funcao","")).strip()))
        return jsonify(ok=True)
    except (KeyError,ValueError,sqlite3.IntegrityError):
        return jsonify(erro="Contato ou empresa inválido."), 400

@app.get("/api/pesquisa")
def pesquisa():
    q = request.args.get("q","").strip()
    terms = f"%{q.lower()}%"
    num = f"%{digits(q)}%" if digits(q) else ""
    with connect() as db:
        rows = db.execute("""
          SELECT DISTINCT c.id,c.nome,c.telefone FROM contatos c
          LEFT JOIN vinculos v ON v.contato_id=c.id
          LEFT JOIN empresas e ON e.id=v.empresa_id
          WHERE lower(c.nome) LIKE ? OR c.telefone LIKE ? OR
                lower(e.nome) LIKE ? OR lower(e.codigo) LIKE ? OR e.documento LIKE ?
          ORDER BY c.nome LIMIT 200
        """, (terms,num,terms,terms,num)).fetchall()
        output = []
        for c in rows:
            item = dict(c)
            item["empresas"] = [dict(e) for e in db.execute("""
                SELECT e.codigo,e.nome,e.tipo,e.documento,v.funcao FROM empresas e
                JOIN vinculos v ON v.empresa_id=e.id WHERE v.contato_id=?
                ORDER BY e.nome""",(c["id"],))]
            output.append(item)
        return jsonify(output)

HEADINGS = {
    "codigo": {"codigo","codigo empresa","codigo da empresa","cod empresa","cod"},
    "nome": {"nome","nome da empresa","razao social","empresa"},
    "tipo": {"tipo","tipo inscricao","tipo de inscricao","inscricao tipo"},
    "documento": {"documento","cnpj","cpf","caepf","cei","cnpj cpf caepf cei","cnpj/cpf/caepf/cei","inscricao"}
}
def clean_header(t):
    import unicodedata
    t = unicodedata.normalize("NFKD",str(t or "").lower())
    return re.sub(r"\s+"," ", "".join(x for x in t if not unicodedata.combining(x)).replace("_"," ")).strip()

def parse_excel(blob):
    wb = load_workbook(io.BytesIO(blob),read_only=True,data_only=True)
    sheet = wb.active
    values = sheet.iter_rows(values_only=True)
    header = [clean_header(v) for v in next(values,[])]
    cols = {}
    for field, names in HEADINGS.items():
        index = next((i for i,h in enumerate(header) if h in names),None)
        if index is not None:
            cols[field] = index
    if not {"codigo","nome","documento"} <= cols.keys():
        raise ValueError("Planilha precisa ter colunas Código, Nome da empresa e CNPJ/CPF/CAEPF/CEI.")
    records=[]
    for n,row in enumerate(values,2):
        if not any(v is not None and str(v).strip() for v in row):
            continue
        def get(k):
            idx=cols.get(k)
            return str(row[idx]).strip() if idx is not None and idx < len(row) and row[idx] is not None else ""
        tipo = get("tipo").upper()
        if not tipo:
            doc_header = header[cols["documento"]]
            tipo = doc_header.upper() if doc_header in ("cnpj","cpf","caepf","cei") else ""
        codigo = get("codigo")
        if codigo.endswith(".0") and codigo[:-2].isdigit(): codigo=codigo[:-2]
        records.append({"linha":n,"codigo":codigo,"nome":get("nome"),"tipo":tipo,"documento":get("documento")})
    wb.close()
    return records

def inspect(records):
    seen_codes,seen_docs=set(),set()
    result=[]
    with connect() as db:
        for record in records:
            n=record["linha"]
            try:
                item=normalize_company(record)
                status,description=company_status(db,item)
                key=(item["tipo"],item["documento"])
                if item["codigo"] in seen_codes or key in seen_docs:
                    status,description="conflito","Registro repetido dentro da planilha."
                seen_codes.add(item["codigo"])
                seen_docs.add(key)
            except ValueError as exc:
                item={k:record.get(k,"") for k in ("codigo","nome","tipo","documento")}
                status,description="invalido",str(exc)
            result.append({"linha":n,**item,"status":status,"detalhe":description})
    return result

@app.post("/api/importar/previa")
def previa():
    uploaded=request.files.get("arquivo")
    if not uploaded or not uploaded.filename.lower().endswith(".xlsx"):
        return jsonify(erro="Envie um arquivo .xlsx."),400
    data=uploaded.read()
    if len(data)>10*1024*1024:
        return jsonify(erro="Arquivo excede 10 MB."),400
    try:
        records=parse_excel(data)
        return jsonify(linhas=inspect(records))
    except Exception as e:
        return jsonify(erro=f"Não foi possível ler a planilha: {e}"),400

@app.post("/api/importar/confirmar")
def confirmar():
    lines=request.get_json(force=True).get("linhas",[])
    if not isinstance(lines,list) or len(lines)>10000:
        return jsonify(erro="Lista inválida."),400
    rows=inspect(lines)
    if any(row["status"] in ("conflito","invalido") for row in rows):
        return jsonify(erro="Resolva as linhas inválidas ou conflitantes antes de confirmar.",linhas=rows),409
    with connect() as db:
        for r in rows:
            if r["status"]=="novo":
                db.execute("INSERT INTO empresas(codigo,nome,tipo,documento) VALUES (?,?,?,?)",
                           (r["codigo"],r["nome"],r["tipo"],r["documento"]))
            else:
                db.execute("UPDATE empresas SET nome=? WHERE codigo=? AND tipo=? AND documento=?",
                           (r["nome"],r["codigo"],r["tipo"],r["documento"]))
    return jsonify(ok=True,importados=len(rows))


@app.post("/api/whatsapp/sync")
def sync_whatsapp_contacts():
    token = os.environ.get("WA_SYNC_TOKEN", "")
    received = request.headers.get("X-Sync-Token", "")
    if not token or not hmac.compare_digest(token, received):
        return jsonify(erro="Não autorizado"), 403
    data = request.get_json(silent=True) or {}
    items = data.get("contatos", [])
    if not isinstance(items, list) or len(items) > 20000:
        return jsonify(erro="Lista inválida"), 400
    novos, existentes, nomes_atualizados = 0, 0, 0
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        known = {}
        for row in db.execute('SELECT id,nome,telefone FROM contatos'):
            try:
                known[phone_key(row['telefone'])] = row
            except ValueError:
                continue
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                phone = phone_key('+' + digits(item.get("telefone")))
            except ValueError:
                continue
            name = str(item.get("nome", "")).strip()[:200]
            if not 10 <= len(phone) <= 15:
                continue
            if phone in known:
                old = known[phone]
                if name and not re.fullmatch(r'[+\d\s().-]+', name) and re.fullmatch(r'[+\d\s().-]+', old['nome']):
                    db.execute('UPDATE contatos SET nome=? WHERE id=?', (name, old['id']))
                    known[phone] = {'id': old['id'], 'nome': name}
                    nomes_atualizados += 1
                existentes += 1
                continue
            if not name:
                name = phone
            inserted = db.execute("INSERT INTO contatos(nome,telefone) VALUES (?,?)", (name,'+' + phone))
            known[phone] = {'id': inserted.lastrowid, 'nome': name}
            novos += 1
    return jsonify(ok=True,novos=novos,existentes=existentes,nomes_atualizados=nomes_atualizados)


@app.post('/api/contatos/importar/previa')
def contact_preview():
    uploaded = request.files.get('arquivo')
    if not uploaded or not uploaded.filename.lower().endswith(('.csv', '.vcf')):
        return jsonify(erro='Selecione um CSV do Google Contacts ou vCard (.vcf).'), 400
    blob = uploaded.read(10 * 1024 * 1024 + 1)
    if len(blob) > 10 * 1024 * 1024:
        return jsonify(erro='Arquivo excede 10 MB.'), 400
    try:
        records = parse_csv(blob) if uploaded.filename.lower().endswith('.csv') else parse_vcard(blob)
        if not records or len(records) > 20000:
            raise ValueError('Arquivo vazio ou excede 20.000 telefones.')
        with connect() as db:
            return jsonify(linhas=inspect_contacts(db, records))
    except (ValueError, UnicodeError, LookupError, csv.Error) as exc:
        return jsonify(erro=f'Não foi possível ler os contatos: {exc}'), 400


@app.post('/api/contatos/importar/confirmar')
def contact_confirm():
    body = request.get_json(silent=True)
    records = body.get('linhas') if isinstance(body, dict) else None
    if not isinstance(records, list) or not records or len(records) > 20000 or any(not isinstance(r, dict) for r in records):
        return jsonify(erro='Lista de contatos inválida.'), 400
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        rows = inspect_contacts(db, records)
        if any(r['status'] == 'invalido' for r in rows):
            return jsonify(erro='Corrija os telefones e nomes inválidos antes de importar.', linhas=rows), 409
        new = 0
        for row in rows:
            if row['status'] == 'novo':
                db.execute('INSERT INTO contatos(nome,telefone) VALUES (?,?)', (row['nome'], row['telefone']))
                new += 1
    return jsonify(ok=True, novos=new, preservados=len(rows)-new)

if __name__=="__main__":
    init_db()
    app.run(host="127.0.0.1",port=8765,debug=False)
