"""Additive users, departments, connection-aware routing and audited histories."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime
from flask import Blueprint, request, jsonify, g
from werkzeug.security import generate_password_hash, check_password_hash
from attendance_workflow import init_workflow, register_workflow

DEPARTMENTS = ('Recepção','Rural','Pessoal','Fiscal','Contábil','Financeiro','Empresarial')
COOKIE = 'gestao_sessao'


def init_management(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS gestao_conexoes (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, numero TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'aguardando', atualizado REAL NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO gestao_conexoes(id,nome) VALUES (1,'Conexão atual do aplicativo');
    CREATE TABLE IF NOT EXISTS departamentos (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE, ativo INTEGER NOT NULL DEFAULT 1,
      conexao_id INTEGER NOT NULL DEFAULT 1 REFERENCES gestao_conexoes(id));
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL, perfil TEXT NOT NULL CHECK(perfil IN ('admin','atendente')),
      departamento_id INTEGER REFERENCES departamentos(id), ativo INTEGER NOT NULL DEFAULT 1,
      triagem INTEGER NOT NULL DEFAULT 0, criado REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS usuario_empresas (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      departamento_id INTEGER NOT NULL REFERENCES departamentos(id),
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      PRIMARY KEY(usuario_id,departamento_id,empresa_id));
    CREATE TABLE IF NOT EXISTS gestao_sessoes (
      token_hash TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), expira REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS gestao_login_limite (chave TEXT PRIMARY KEY, tentativas INTEGER NOT NULL, desde REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS atendimentos (
      id INTEGER PRIMARY KEY, conexao_id INTEGER NOT NULL REFERENCES gestao_conexoes(id),
      conversa_id TEXT NOT NULL, contato_nome TEXT NOT NULL, empresa_id INTEGER REFERENCES empresas(id),
      empresa_nome TEXT NOT NULL DEFAULT '', empresa_codigo TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '', departamento_entrada INTEGER NOT NULL REFERENCES departamentos(id),
      entrada_nome TEXT NOT NULL, departamento_atual INTEGER NOT NULL REFERENCES departamentos(id),
      atual_nome TEXT NOT NULL, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), usuario_nome TEXT NOT NULL,
      iniciado REAL NOT NULL, encerrado REAL, status TEXT NOT NULL DEFAULT 'aberto',
      protocolo INTEGER UNIQUE, assunto TEXT NOT NULL, resumo TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS atendimento_unico_aberto
      ON atendimentos(conexao_id,conversa_id) WHERE status IN ('aberto','pendencia','documentacao');
    CREATE INDEX IF NOT EXISTS atendimento_periodo ON atendimentos(iniciado,departamento_atual);
    CREATE TABLE IF NOT EXISTS atendimento_eventos (
      id INTEGER PRIMARY KEY, atendimento_id INTEGER NOT NULL REFERENCES atendimentos(id),
      tipo TEXT NOT NULL, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), usuario_nome TEXT NOT NULL,
      horario REAL NOT NULL, dados TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS atendimento_mensagens (
      atendimento_id INTEGER NOT NULL REFERENCES atendimentos(id), mensagem_id TEXT NOT NULL,
      timestamp REAL NOT NULL, dados TEXT NOT NULL, PRIMARY KEY(atendimento_id,mensagem_id));
    CREATE TABLE IF NOT EXISTS protocolo_sequencia (id INTEGER PRIMARY KEY CHECK(id=1), ultimo INTEGER NOT NULL);
    INSERT OR IGNORE INTO protocolo_sequencia VALUES (1,0);
    ''')
    for number,name in enumerate(DEPARTMENTS,1):
        db.execute('INSERT OR IGNORE INTO departamentos(id,nome) VALUES (?,?)',(number,name))
    init_workflow(db)


def capture_open_attendances(db):
    # Only messages already in the local cache, after this attendance began.
    db.execute('''INSERT INTO atendimento_mensagens(atendimento_id,mensagem_id,timestamp,dados)
      SELECT a.id,m.id,m.timestamp,m.dados FROM atendimentos a JOIN wa_mensagens m ON m.conversa_id=a.conversa_id
      WHERE a.status IN ('aberto','pendencia','documentacao') AND a.conexao_id=1 AND m.timestamp>=a.iniciado
      AND NOT EXISTS(SELECT 1 FROM fluxo_mensagens f WHERE f.conexao_id=1 AND f.mensagem_id=m.id AND f.atendimento_id IS NOT a.id)
      AND (SELECT estado FROM gestao_conexoes WHERE id=1)<>'divergente'
      AND NOT EXISTS(SELECT 1 FROM wa_omitidas o WHERE o.mensagem_id=m.id)
      ON CONFLICT(atendimento_id,mensagem_id) DO UPDATE SET dados=excluded.dados,timestamp=excluded.timestamp''')


def register_management(app, connect):
    bp = Blueprint('gestao',__name__,url_prefix='/api/gestao')

    def fail(message,code=400):
        return jsonify(erro=message),code

    def payload():
        value=request.get_json(silent=True)
        if not isinstance(value,dict):
            raise ValueError('Dados inválidos.')
        return value

    def clean(value,label,limit=200):
        text=str(value or '').strip()
        if not text or len(text)>limit:
            raise ValueError(f'Preencha {label} com até {limit} caracteres.')
        return text

    def ident(value):
        if isinstance(value,bool):raise ValueError('Identificador inválido.')
        try:number=int(value)
        except (ValueError,TypeError):raise ValueError('Identificador inválido.')
        if number<1 or number>9223372036854775807 or (isinstance(value,float) and value!=number):raise ValueError('Identificador inválido.')
        return number

    def public_user(db,row):
        user={k:row[k] for k in ('id','nome','login','perfil','departamento_id','ativo','triagem')}
        user['empresas']=[r[0] for r in db.execute('SELECT empresa_id FROM usuario_empresas WHERE usuario_id=? AND departamento_id=?',(row['id'],row['departamento_id']))]
        return user

    def set_session(db,user_id):
        token=secrets.token_urlsafe(32)
        db.execute('DELETE FROM gestao_sessoes WHERE expira<?',(time.time(),))
        db.execute('INSERT INTO gestao_sessoes VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user_id,time.time()+28800))
        response=jsonify(ok=True)
        response.delete_cookie(COOKIE,path='/api/gestao')
        response.set_cookie(COOKIE,token,max_age=28800,httponly=True,samesite='Strict',path='/api')
        return response

    def admin():return g.user['perfil']=='admin'

    @bp.after_request
    def private_response(response):
        response.headers['Cache-Control']='no-store'
        return response

    @bp.before_request
    def authenticate():
        limit=25*1024*1024 if request.path.endswith('/enviar') or '/ponte/' in request.path else 131072
        if request.content_length and request.content_length>limit:return fail('Dados maiores que o permitido.',413)
        if request.host.split(':')[0] not in ('127.0.0.1','localhost','[::1]'):
            return fail('Host não autorizado.',403)
        if request.method!='GET' and request.headers.get('Origin') not in (None,'http://127.0.0.1:8765','http://localhost:8765'):
            return fail('Origem não autorizada.',403)
        if '/api/gestao/ponte/' in request.path:
            token=os.environ.get('WA_SYNC_TOKEN','')
            if not token or not hmac.compare_digest(token,request.headers.get('X-Sync-Token','')):return fail('Ponte não autorizada.',403)
            return
        if request.endpoint in ('gestao.setup','gestao.login','gestao.status','gestao.connection_state'):
            return
        token=request.cookies.get(COOKIE,'')
        with connect() as db:
            row=db.execute('''SELECT u.* FROM gestao_sessoes s JOIN usuarios u ON u.id=s.usuario_id
              WHERE s.token_hash=? AND s.expira>? AND u.ativo=1''',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
            if not row:return fail('Entre com seu usuário para acessar a gestão.',401)
            g.user=dict(row)

    @bp.errorhandler(ValueError)
    def invalid(error):return fail(str(error))

    @bp.errorhandler(sqlite3.IntegrityError)
    def conflict(error):return fail('Cadastro já existente ou vínculo inválido. Confira os dados.',409)

    @bp.get('/status')
    def status():
        with connect() as db:
            return jsonify(configurado=bool(db.execute('SELECT 1 FROM usuarios LIMIT 1').fetchone()))

    @bp.post('/configurar')
    def setup():
        data=payload();name=clean(data.get('nome'),'o nome');login=clean(data.get('login'),'o login',80).lower();password=str(data.get('senha') or '')
        if not 8<=len(password)<=128:raise ValueError('Use uma senha entre 8 e 128 caracteres.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM usuarios LIMIT 1').fetchone():return fail('O administrador inicial já foi criado.',409)
            result=db.execute("INSERT INTO usuarios(nome,login,senha_hash,perfil,triagem,criado) VALUES (?,?,?,'admin',1,?)",(name,login,generate_password_hash(password),time.time()))
            return set_session(db,result.lastrowid)

    @bp.post('/login')
    def login():
        data=payload();username=clean(data.get('login'),'o login',80).lower();password=str(data.get('senha',''))[:129]
        with connect() as db:
            key=hashlib.sha256((request.remote_addr or 'local').encode()).hexdigest()
            limit=db.execute('SELECT * FROM gestao_login_limite WHERE chave=?',(key,)).fetchone()
            if limit and limit['tentativas']>=10 and time.time()-limit['desde']<600:return fail('Muitas tentativas. Aguarde dez minutos.',429)
            row=db.execute('SELECT * FROM usuarios WHERE login=? AND ativo=1',(username,)).fetchone()
            if not row or not check_password_hash(row['senha_hash'],password):
                db.execute('''INSERT INTO gestao_login_limite VALUES (?,1,?) ON CONFLICT(chave) DO UPDATE SET
                  tentativas=CASE WHEN excluded.desde-desde>=600 THEN 1 ELSE tentativas+1 END,
                  desde=CASE WHEN excluded.desde-desde>=600 THEN excluded.desde ELSE desde END''',(key,time.time()))
                return fail('Login ou senha inválidos.',401)
            db.execute('DELETE FROM gestao_login_limite WHERE chave=?',(key,))
            return set_session(db,row['id'])

    @bp.post('/sair')
    def logout():
        with connect() as db:db.execute('DELETE FROM gestao_sessoes WHERE token_hash=?',(hashlib.sha256(request.cookies.get(COOKIE,'').encode()).hexdigest(),))
        response=jsonify(ok=True);response.delete_cookie(COOKIE,path='/api');response.delete_cookie(COOKIE,path='/api/gestao');return response

    @bp.get('/contexto')
    def context():
        with connect() as db:
            deps=[dict(r) for r in db.execute('SELECT * FROM departamentos ORDER BY id')]
            own=next((d for d in deps if d['id']==g.user['departamento_id']),None)
            allowed=deps if admin() else [d for d in deps if d['id']==g.user['departamento_id'] or (g.user['triagem'] and own and d['conexao_id']==own['conexao_id'])]
            companies=[dict(r) for r in db.execute('SELECT id,nome,codigo FROM empresas ORDER BY nome')]
            if not admin() and not g.user['triagem']:
                ids=public_user(db,g.user)['empresas'];companies=[c for c in companies if c['id'] in ids]
            users=[dict(r) for r in db.execute('SELECT id,nome,departamento_id FROM usuarios ORDER BY nome')]
            if not admin():users=[u for u in users if u['departamento_id']==g.user['departamento_id']]
            connections=[dict(r) for r in db.execute('SELECT * FROM gestao_conexoes')]
            if not admin():
                for connection in connections:connection.pop('qr',None)
            return jsonify(usuario=public_user(db,g.user),usuarios=users,departamentos=allowed,empresas=companies,conexoes=connections)

    @bp.route('/departamentos',methods=['GET','POST'])
    @bp.put('/departamentos/<int:department_id>')
    def departments(department_id=None):
        if not admin():return fail('Somente administradores gerenciam departamentos.',403)
        with connect() as db:
            if request.method=='GET':return jsonify([dict(r) for r in db.execute('SELECT * FROM departamentos ORDER BY id')])
            data=payload();name=clean(data.get('nome'),'o nome do departamento',80);active=1 if data.get('ativo',True) else 0
            if department_id:
                if not db.execute('SELECT 1 FROM departamentos WHERE id=?',(department_id,)).fetchone():return fail('Departamento não encontrado.',404)
                if not active and db.execute("SELECT 1 FROM usuarios WHERE departamento_id=? AND ativo=1 UNION SELECT 1 FROM atendimentos WHERE departamento_atual=? AND status IN ('aberto','pendencia','documentacao')",(department_id,department_id)).fetchone():return fail('Realoque usuários e atendimentos antes de desativar o departamento.',409)
                db.execute('UPDATE departamentos SET nome=?,ativo=? WHERE id=?',(name,active,department_id))
            else:db.execute('INSERT INTO departamentos(nome) VALUES (?)',(name,))
            return jsonify(ok=True)

    @bp.route('/usuarios',methods=['GET','POST'])
    @bp.put('/usuarios/<int:user_id>')
    def users(user_id=None):
        if not admin():return fail('Somente administradores gerenciam usuários.',403)
        with connect() as db:
            if request.method=='GET':return jsonify([public_user(db,r) for r in db.execute('SELECT * FROM usuarios ORDER BY nome')])
            data=payload();name=clean(data.get('nome'),'o nome');username=clean(data.get('login'),'o login',80).lower()
            role=data.get('perfil','atendente')
            if role not in ('admin','atendente'):raise ValueError('Perfil inválido.')
            dep=ident(data['departamento_id']) if data.get('departamento_id') else None
            if role=='atendente' and not dep:raise ValueError('Escolha o departamento do atendente.')
            if dep and not db.execute('SELECT 1 FROM departamentos WHERE id=? AND ativo=1',(dep,)).fetchone():raise ValueError('Departamento indisponível.')
            active=1 if data.get('ativo',True) else 0;triage=1 if data.get('triagem',False) else 0
            companies=data.get('empresas',[])
            if not isinstance(companies,list) or len(companies)>1000:raise ValueError('Lista de empresas inválida.')
            company_ids=list(set(ident(c) for c in companies))
            if company_ids and not dep:raise ValueError('Escolha o departamento para vincular responsabilidades.')
            if any(not db.execute('SELECT 1 FROM empresas WHERE id=?',(c,)).fetchone() for c in company_ids):raise ValueError('Empresa não encontrada.')
            if active and any(db.execute('''SELECT 1 FROM usuario_empresas e JOIN usuarios u ON u.id=e.usuario_id
              WHERE e.departamento_id=? AND e.empresa_id=? AND u.ativo=1 AND u.id<>?''',(dep,c,user_id or 0)).fetchone() for c in company_ids):
                return fail('Uma dessas empresas já possui responsável ativo no departamento. Remova o vínculo anterior antes de atribuí-lo.',409)
            password=str(data.get('senha') or '')
            if password and (len(password)<8 or len(password)>128):raise ValueError('Use uma senha entre 8 e 128 caracteres.')
            if user_id:
                old=db.execute('SELECT * FROM usuarios WHERE id=?',(user_id,)).fetchone()
                if not old:return fail('Usuário não encontrado.',404)
                pending=db.execute('''SELECT a.empresa_id FROM fluxo_transferencias t JOIN atendimentos a ON a.id=t.origem_id
                  WHERE t.usuario_id=? AND t.iniciado_id IS NULL''',(user_id,)).fetchall()
                if pending and (not active or old['departamento_id']!=dep or any(r['empresa_id'] and r['empresa_id'] not in company_ids for r in pending)):
                    return fail('Há transferências aguardando início. Resolva essas pendências antes de desativar ou alterar os vínculos do usuário.',409)
                if old['departamento_id']!=dep and db.execute("SELECT 1 FROM atendimentos WHERE usuario_id=? AND status IN ('aberto','pendencia','documentacao')",(user_id,)).fetchone():return fail('Transfira ou encerre os atendimentos antes de trocar o departamento do usuário.',409)
                if old['perfil']=='admin' and old['ativo'] and (role!='admin' or not active) and db.execute("SELECT count(*) FROM usuarios WHERE perfil='admin' AND ativo=1").fetchone()[0]<=1:return fail('Mantenha ao menos um administrador ativo.',409)
                if not active and db.execute("SELECT 1 FROM atendimentos WHERE usuario_id=? AND status IN ('aberto','pendencia','documentacao')",(user_id,)).fetchone():return fail('Transfira ou encerre os atendimentos antes de desativar o usuário.',409)
                db.execute('UPDATE usuarios SET nome=?,login=?,perfil=?,departamento_id=?,ativo=?,triagem=? WHERE id=?',(name,username,role,dep,active,triage,user_id))
                if password:db.execute('UPDATE usuarios SET senha_hash=? WHERE id=?',(generate_password_hash(password),user_id))
                db.execute('DELETE FROM gestao_sessoes WHERE usuario_id=?',(user_id,))
                db.execute('DELETE FROM usuario_empresas WHERE usuario_id=?',(user_id,))
            else:
                if not password:raise ValueError('Defina uma senha para o novo usuário.')
                user_id=db.execute('INSERT INTO usuarios(nome,login,senha_hash,perfil,departamento_id,ativo,triagem,criado) VALUES (?,?,?,?,?,?,?,?)',(name,username,generate_password_hash(password),role,dep,active,triage,time.time())).lastrowid
            for cid in company_ids:db.execute('INSERT INTO usuario_empresas VALUES (?,?,?)',(user_id,dep,cid))
            return jsonify(ok=True,id=user_id)

    @bp.post('/conexao-atual')
    def connection_state():
        token=os.environ.get('WA_SYNC_TOKEN','')
        if not token or not hmac.compare_digest(token,request.headers.get('X-Sync-Token','')):return fail('Acesso não autorizado.',403)
        data=payload();number=re.sub(r'\D','',str(data.get('numero','')))
        if number and not 10<=len(number)<=15:raise ValueError('Número da conexão inválido.')
        status=data.get('estado')
        if status not in ('conectado','desconectado','aguardando'):raise ValueError('Estado inválido.')
        with connect() as db:
            old=db.execute('SELECT numero FROM gestao_conexoes WHERE id=1').fetchone()[0]
            if number and old and number!=old:
                db.execute("UPDATE gestao_conexoes SET estado='divergente',atualizado=? WHERE id=1",(time.time(),))
                return fail('A sessão utiliza outro número. Os históricos não serão reassociados automaticamente.',409)
            db.execute('UPDATE gestao_conexoes SET numero=?,estado=?,atualizado=? WHERE id=1',(number or old,status,time.time()))
            return jsonify(ok=True)

    def can_view(db,a):
        if admin():return True
        if a['departamento_atual']!=g.user['departamento_id']:return False
        if a['usuario_id']==g.user['id']:return True
        return bool(a['empresa_id'] and db.execute('SELECT 1 FROM usuario_empresas WHERE usuario_id=? AND departamento_id=? AND empresa_id=?',(g.user['id'],a['departamento_atual'],a['empresa_id'])).fetchone())

    def attendance(db,aid):
        row=db.execute('SELECT * FROM atendimentos WHERE id=?',(aid,)).fetchone()
        if not row:return None
        return dict(row) if can_view(db,row) else False

    def public_attendance(row):
        result=dict(row)
        if result['usuario_id']!=g.user['id']:
            result['pendencia']='';result['prazo']=''
        return result

    def audit(db,aid,kind,details):
        db.execute('INSERT INTO atendimento_eventos(atendimento_id,tipo,usuario_id,usuario_nome,horario,dados) VALUES (?,?,?,?,?,?)',(aid,kind,g.user['id'],g.user['nome'],time.time(),json.dumps(details,ensure_ascii=False)))

    def date_value(value,end=False):
        if not value:return None
        try:
            # Dates use the client's fixed UTC-4 timezone for local filters.
            stamp=datetime.strptime(value,'%Y-%m-%d');return (stamp-datetime(1970,1,1)).total_seconds()+14400+(86400 if end else 0)
        except ValueError:raise ValueError('Data inválida; use dia/mês/ano nos filtros.')

    @bp.route('/atendimentos',methods=['GET','POST'])
    def attendances():
        with connect() as db:
            if request.method=='POST':
                data=payload();dep=ident(data.get('departamento_id'));cid=ident(data['empresa_id']) if data.get('empresa_id') else None
                department=db.execute('SELECT * FROM departamentos WHERE id=? AND ativo=1',(dep,)).fetchone()
                if not department:raise ValueError('Departamento indisponível.')
                if not admin() and dep!=g.user['departamento_id']:return fail('Departamento não autorizado.',403)
                if cid and not admin() and not db.execute('SELECT 1 FROM usuario_empresas WHERE usuario_id=? AND departamento_id=? AND empresa_id=?',(g.user['id'],dep,cid)).fetchone():return fail('Empresa fora da sua responsabilidade.',403)
                if not cid and not admin() and not g.user['triagem']:return fail('Você não possui acesso à triagem sem empresa.',403)
                chatid=clean(data.get('conversa_id'),'a conversa',100)
                chat=db.execute('SELECT dados FROM wa_conversas WHERE id=?',(chatid,)).fetchone()
                if not chat:raise ValueError('Conversa ainda não salva no histórico local. Aguarde a gravação e tente novamente.')
                company=db.execute('SELECT * FROM empresas WHERE id=?',(cid,)).fetchone() if cid else None
                if cid and not company:raise ValueError('Empresa não encontrada.')
                connection=db.execute('SELECT * FROM gestao_conexoes WHERE id=?',(department['conexao_id'],)).fetchone()
                if connection['id']!=1 or connection['estado']!='conectado' or not connection['numero']:return fail('A conexão deste departamento não está disponível para registrar este atendimento.',409)
                subject=clean(data.get('assunto'),'o assunto',200)
                try:
                    aid=db.execute('''INSERT INTO atendimentos(conexao_id,conversa_id,contato_nome,empresa_id,empresa_nome,empresa_codigo,numero,departamento_entrada,entrada_nome,departamento_atual,atual_nome,usuario_id,usuario_nome,iniciado,assunto)
                      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',(1,chatid,json.loads(chat['dados']).get('name') or chatid,cid,company['nome'] if company else '',company['codigo'] if company else '',connection['numero'],dep,department['nome'],dep,department['nome'],g.user['id'],g.user['nome'],time.time(),subject)).lastrowid
                except sqlite3.IntegrityError:
                    return fail('Já existe atendimento aberto para esta conexão e conversa. Consulte a lista antes de iniciar outro.',409)
                audit(db,aid,'abertura',{'assunto':subject});return jsonify(ok=True,id=aid),201
            filters=[];args=[]
            if not admin():
                filters.append('a.departamento_atual=? AND (a.usuario_id=? OR a.empresa_id IN (SELECT empresa_id FROM usuario_empresas WHERE usuario_id=? AND departamento_id=?))');args.extend([g.user['departamento_id'],g.user['id'],g.user['id'],g.user['departamento_id']])
            for key,column in [('departamento_id','departamento_atual'),('entrada_id','departamento_entrada'),('usuario_id','usuario_id'),('empresa_id','empresa_id'),('conexao_id','conexao_id'),('protocolo','protocolo')]:
                if request.args.get(key):filters.append('a.'+column+'=?');args.append(ident(request.args[key]))
            if request.args.get('status'):
                if request.args['status'] not in ('aberto','encerrado','pendencia','documentacao','ativos'):raise ValueError('Status inválido.')
                if request.args['status']=='ativos':filters.append("a.status IN ('aberto','pendencia','documentacao')")
                else:filters.append('a.status=?');args.append(request.args['status'])
            for key,column in [('contato','conversa_id'),('numero','numero')]:
                if request.args.get(key):filters.append('a.'+column+' LIKE ?');args.append('%'+request.args[key][:100]+'%')
            for key,op,end in [('inicio','>=',False),('fim','<',True)]:
                if request.args.get(key):filters.append('a.iniciado'+op+'?');args.append(date_value(request.args[key],end))
            if request.args.get('busca'):
                filters.append('(a.contato_nome LIKE ? OR a.assunto LIKE ? OR a.empresa_nome LIKE ?)');args.extend(['%'+request.args['busca'][:200]+'%']*3)
            phone_sql="coalesce((SELECT nullif(f.telefone,'') FROM fluxo_mensagens f WHERE f.conexao_id=a.conexao_id AND f.conversa_id=a.conversa_id ORDER BY f.timestamp DESC LIMIT 1), CASE WHEN a.conversa_id LIKE '%@c.us' THEN substr(a.conversa_id,1,instr(a.conversa_id,'@')-1) ELSE '' END)"
            if request.args.get('nome_contato'):
                filters.append('a.contato_nome LIKE ?');args.append('%'+request.args['nome_contato'][:200]+'%')
            if request.args.get('telefone'):
                phone=re.sub(r'\D','',request.args['telefone'][:100])
                if not phone:raise ValueError('Informe os dígitos do telefone.')
                filters.append("replace(replace(replace(replace(replace("+phone_sql+",'+',''),' ',''),'-',''),'(',''),')','') LIKE ?");args.append('%'+phone+'%')
            sorts={'inicio':'a.iniciado','encerramento':'a.encerrado','contato':'a.contato_nome COLLATE NOCASE','telefone':phone_sql,'responsavel':'a.usuario_nome COLLATE NOCASE','protocolo':'a.protocolo'}
            sort=request.args.get('classificar','inicio');direction=request.args.get('ordem','desc')
            if sort not in sorts or direction not in ('asc','desc'):raise ValueError('Ordenação inválida.')
            order=sorts[sort]+' '+direction+',a.id '+direction
            where=' WHERE '+' AND '.join(filters) if filters else ''
            offset=max(0,min(int(request.args.get('offset',0)),100000));total=db.execute('SELECT count(*) FROM atendimentos a'+where,args).fetchone()[0]
            rows=[dict(r) for r in db.execute('SELECT a.*,'+phone_sql+' telefone FROM atendimentos a'+where+' ORDER BY '+order+' LIMIT 50 OFFSET ?',args+[offset])]
            return jsonify(itens=[public_attendance(row) for row in rows],total=total,offset=offset)

    @bp.get('/atendimentos/<int:aid>')
    def details(aid):
        with connect() as db:
            a=attendance(db,aid)
            if a is None:return fail('Atendimento não encontrado.',404)
            if a is False:return fail('Atendimento não autorizado.',403)
            offset=max(0,min(int(request.args.get('offset',0)),100000));count=db.execute('SELECT count(*) FROM atendimento_mensagens WHERE atendimento_id=?',(aid,)).fetchone()[0]
            messages=[json.loads(r[0]) for r in db.execute('SELECT dados FROM atendimento_mensagens WHERE atendimento_id=? ORDER BY timestamp,mensagem_id LIMIT 100 OFFSET ?',(aid,offset))]
            events=[dict(r) for r in db.execute('SELECT * FROM atendimento_eventos WHERE atendimento_id=? ORDER BY horario,id',(aid,))]
            for event in events:
                event['dados']=json.loads(event['dados'])
                if a['usuario_id']!=g.user['id'] and event['tipo']=='situacao':
                    event['dados'].pop('pendencia',None);event['dados'].pop('prazo',None)
            photo=db.execute('SELECT foto FROM fluxo_contatos WHERE conexao_id=? AND conversa_id=?',(a['conexao_id'],a['conversa_id'])).fetchone()
            presence=db.execute('SELECT tipo FROM fluxo_presenca WHERE conexao_id=? AND conversa_id=? AND expira>?',(a['conexao_id'],a['conversa_id'],time.time())).fetchone()
            phone=db.execute('SELECT telefone FROM fluxo_mensagens WHERE conexao_id=? AND conversa_id=? ORDER BY timestamp DESC LIMIT 1',(a['conexao_id'],a['conversa_id'])).fetchone()
            return jsonify(atendimento=public_attendance(a),mensagens=messages,eventos=events,total_mensagens=count,offset=offset,telefone=phone[0] if phone else a['conversa_id'].split('@')[0],foto=photo[0] if photo else None,presenca=presence[0] if presence else None)

    @bp.post('/atendimentos/<int:aid>/encerrar')
    def finish(aid):
        data=payload();summary=str(data.get('resumo') or '').strip()[:4000]
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');a=attendance(db,aid)
            if not a:return fail('Atendimento não autorizado ou inexistente.',403)
            if a['status']=='encerrado':return jsonify(ok=True,protocolo=a['protocolo'])
            if not a['empresa_id']:
                if not data.get('empresa_id'):return fail('Vincule a empresa para concluir o atendimento.',409)
                company_id=ident(data['empresa_id']);company=db.execute('SELECT * FROM empresas WHERE id=?',(company_id,)).fetchone()
                if not company:return fail('Empresa inexistente.',400)
                if not admin() and not db.execute('SELECT 1 FROM usuario_empresas WHERE usuario_id=? AND departamento_id=? AND empresa_id=?',(g.user['id'],a['departamento_atual'],company_id)).fetchone():return fail('Empresa fora da sua responsabilidade.',403)
                db.execute('UPDATE atendimentos SET empresa_id=?,empresa_nome=?,empresa_codigo=? WHERE id=?',(company_id,company['nome'],company['codigo'],aid))
                audit(db,aid,'vinculo_empresa',{'empresa_id':company_id})
            capture_open_attendances(db)
            number=db.execute('SELECT ultimo FROM protocolo_sequencia WHERE id=1').fetchone()[0]+1
            db.execute('UPDATE protocolo_sequencia SET ultimo=? WHERE id=1',(number,))
            db.execute("UPDATE atendimentos SET status='encerrado',encerrado=?,protocolo=?,resumo=? WHERE id=?",(time.time(),number,summary,aid))
            audit(db,aid,'encerramento',{'protocolo':number,'resumo':summary});return jsonify(ok=True,protocolo=number)

    @bp.post('/atendimentos/<int:aid>/transferir')
    def transfer(aid):
        data=payload();destination=ident(data.get('departamento_id'));uid=ident(data.get('usuario_id'));reason=clean(data.get('motivo'),'o motivo da transferência',2000)
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            a=attendance(db,aid)
            if not a:return fail('Atendimento não autorizado ou inexistente.',403)
            if a['status']!='aberto':return fail('Este atendimento já foi encerrado.',409)
            dep=db.execute('SELECT * FROM departamentos WHERE id=? AND ativo=1',(destination,)).fetchone();user=db.execute('SELECT * FROM usuarios WHERE id=? AND ativo=1 AND departamento_id=?',(uid,destination)).fetchone()
            if not dep or not user:raise ValueError('Escolha um usuário ativo no departamento de destino.')
            if dep['conexao_id']!=a['conexao_id']:return fail('Transferência para outro número será implementada na etapa de múltiplas conexões.',409)
            if a['empresa_id'] and user['perfil']!='admin' and not db.execute('SELECT 1 FROM usuario_empresas WHERE usuario_id=? AND departamento_id=? AND empresa_id=?',(uid,destination,a['empresa_id'])).fetchone():return fail('O destinatário não é responsável por esta empresa nesse departamento.',403)
            if not a['empresa_id'] and user['perfil']!='admin' and not user['triagem']:return fail('O destinatário não possui acesso à triagem.',403)
            if a['usuario_id']==uid and a['departamento_atual']==destination:raise ValueError('O atendimento já pertence a esse responsável.')
            db.execute('UPDATE atendimentos SET departamento_atual=?,atual_nome=?,usuario_id=?,usuario_nome=? WHERE id=?',(destination,dep['nome'],uid,user['nome'],aid))
            audit(db,aid,'transferencia',{'origem':a['atual_nome'],'destino':dep['nome'],'de':a['usuario_nome'],'para':user['nome'],'motivo':reason});return jsonify(ok=True)

    @bp.get('/destinos')
    def destinations():
        with connect() as db:
            return jsonify([dict(r) for r in db.execute('''SELECT u.id,u.nome,u.departamento_id,d.nome departamento FROM usuarios u JOIN departamentos d ON d.id=u.departamento_id WHERE u.ativo=1 AND d.ativo=1 ORDER BY d.nome,u.nome''')])

    @bp.get('/legado')
    def legacy():
        if not admin():return fail('O histórico anterior sem classificação é restrito ao administrador.',403)
        with connect() as db:
            chatid=request.args.get('conversa_id')
            if not chatid:return jsonify([{'id':r['id'],'nome':json.loads(r['dados']).get('name') or r['id'],'mensagens':r['total']} for r in db.execute('SELECT c.id,c.dados,count(m.id) total FROM wa_conversas c LEFT JOIN wa_mensagens m ON m.conversa_id=c.id GROUP BY c.id ORDER BY c.id')])
            filters=['conversa_id=?'];args=[chatid]
            for key,op,end in [('inicio','>=',False),('fim','<',True)]:
                if request.args.get(key):filters.append('timestamp'+op+'?');args.append(date_value(request.args[key],end))
            if request.args.get('busca'):filters.append("coalesce(json_extract(dados,'$.body'),'') LIKE ?");args.append('%'+request.args['busca'][:200]+'%')
            offset=max(0,min(int(request.args.get('offset',0)),100000));where=' WHERE '+' AND '.join(filters)
            count=db.execute('SELECT count(*) FROM wa_mensagens'+where,args).fetchone()[0]
            rows=[json.loads(r[0]) for r in db.execute('SELECT dados FROM wa_mensagens'+where+' ORDER BY timestamp,id LIMIT 100 OFFSET ?',args+[offset])]
            return jsonify(mensagens=rows,total=count,offset=offset)

    @bp.get('/atendimentos/<int:aid>/midia/<path:mid>')
    @bp.get('/legado/midia/<path:mid>')
    def media(mid,aid=None):
        with connect() as db:
            if aid is None:
                if not admin():return fail('Histórico anterior restrito ao administrador.',403)
            else:
                a=attendance(db,aid)
                if not a:return fail('Atendimento não autorizado.',403)
                if not db.execute('SELECT 1 FROM atendimento_mensagens WHERE atendimento_id=? AND mensagem_id=?',(aid,mid)).fetchone():return fail('Mensagem fora deste atendimento.',403)
            row=db.execute('SELECT dados FROM fluxo_midias WHERE conexao_id=? AND mensagem_id=?',(a['conexao_id'],mid)).fetchone() if aid is not None else None
            if not row and (aid is None or a['conexao_id']==1):row=db.execute('SELECT dados FROM wa_midias WHERE mensagem_id=?',(mid,)).fetchone()
            if not row:return fail('Mídia ainda não disponível no cache local.',404)
            return jsonify(json.loads(row['dados']))

    register_workflow(bp,connect,dict(fail=fail,payload=payload,ident=ident,clean=clean,admin=admin,attendance=attendance,audit=audit,public_attendance=public_attendance))
    app.register_blueprint(bp)

    @app.before_request
    def protect_legacy_api():
        if not request.path.startswith('/api/') or request.path.startswith('/api/gestao/'):return
        token=os.environ.get('WA_SYNC_TOKEN','')
        if token and hmac.compare_digest(token,request.headers.get('X-Sync-Token','')):return
        with connect() as db:
            if not db.execute('SELECT 1 FROM usuarios LIMIT 1').fetchone():return
            cookie=request.cookies.get(COOKIE,'')
            user=db.execute('''SELECT u.* FROM usuarios u JOIN gestao_sessoes s ON s.usuario_id=u.id
              WHERE s.token_hash=? AND s.expira>? AND u.ativo=1''',(hashlib.sha256(cookie.encode()).hexdigest(),time.time())).fetchone()
            if not user:return fail('Entre com seu usuário.',401)
            if request.method!='GET' and request.headers.get('Origin') not in (None,'http://127.0.0.1:8765','http://localhost:8765'):return fail('Origem não autorizada.',403)
            if user['perfil']=='admin':return
            if request.path=='/api/empresas' and request.method=='GET':
                return jsonify([dict(r) for r in db.execute('SELECT * FROM empresas WHERE id IN (SELECT empresa_id FROM usuario_empresas WHERE usuario_id=? AND departamento_id=?) ORDER BY nome',(user['id'],user['departamento_id']))])
            if request.path=='/api/contatos' and request.method=='GET':
                rows=[dict(r) for r in db.execute('''SELECT DISTINCT c.* FROM contatos c JOIN vinculos v ON v.contato_id=c.id
                  JOIN usuario_empresas e ON e.empresa_id=v.empresa_id WHERE e.usuario_id=? AND e.departamento_id=? ORDER BY c.nome''',(user['id'],user['departamento_id']))]
                for row in rows:row['empresas']=[dict(r) for r in db.execute('''SELECT e.id,e.nome,e.codigo,v.funcao FROM empresas e JOIN vinculos v ON v.empresa_id=e.id WHERE v.contato_id=? AND e.id IN (SELECT empresa_id FROM usuario_empresas WHERE usuario_id=? AND departamento_id=?)''',(row['id'],user['id'],user['departamento_id']))]
                return jsonify(rows)
            return fail('Esta operação é restrita ao administrador. Utilize seus atendimentos na Gestão.',403)
