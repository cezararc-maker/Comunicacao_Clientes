"""Connection-aware routing. Additive migration; original WhatsApp cache is retained."""
import base64
import json
import re
import time
from flask import request, jsonify, g

ACTIVE = ('aberto', 'pendencia', 'documentacao')

def init_workflow(db):
    additions = {
        'gestao_conexoes': {'qr': "TEXT NOT NULL DEFAULT ''", 'erro': "TEXT NOT NULL DEFAULT ''", 'habilitada': 'INTEGER NOT NULL DEFAULT 1'},
        'atendimentos': {'pendencia': "TEXT NOT NULL DEFAULT ''", 'prazo': "TEXT NOT NULL DEFAULT ''", 'origem_id': 'INTEGER'},
    }
    for table, columns in additions.items():
        existing = {r[1] for r in db.execute('PRAGMA table_info('+table+')')}
        for column, definition in columns.items():
            if column not in existing: db.execute('ALTER TABLE '+table+' ADD COLUMN '+column+' '+definition)
    db.executescript('''
      CREATE UNIQUE INDEX IF NOT EXISTS conexao_numero_unico ON gestao_conexoes(numero) WHERE numero<>'';
      CREATE UNIQUE INDEX IF NOT EXISTS atendimento_ativo_unico ON atendimentos(conexao_id,conversa_id)
        WHERE status IN ('aberto','pendencia','documentacao');
      CREATE TABLE IF NOT EXISTS fluxo_mensagens (
        conexao_id INTEGER NOT NULL REFERENCES gestao_conexoes(id), mensagem_id TEXT NOT NULL,
        conversa_id TEXT NOT NULL, telefone TEXT NOT NULL, nome TEXT NOT NULL,
        timestamp REAL NOT NULL, dados TEXT NOT NULL, atendimento_id INTEGER REFERENCES atendimentos(id),
        PRIMARY KEY(conexao_id,mensagem_id));
      CREATE INDEX IF NOT EXISTS fluxo_conversa ON fluxo_mensagens(conexao_id,conversa_id,timestamp);
      CREATE TABLE IF NOT EXISTS fluxo_midias (conexao_id INTEGER NOT NULL, mensagem_id TEXT NOT NULL,
        dados TEXT NOT NULL, PRIMARY KEY(conexao_id,mensagem_id));
      CREATE TABLE IF NOT EXISTS fluxo_contatos (conexao_id INTEGER NOT NULL, conversa_id TEXT NOT NULL,
        foto TEXT NOT NULL DEFAULT '', PRIMARY KEY(conexao_id,conversa_id));
      CREATE TABLE IF NOT EXISTS fluxo_presenca (conexao_id INTEGER NOT NULL, conversa_id TEXT NOT NULL,
        tipo TEXT NOT NULL, expira REAL NOT NULL, PRIMARY KEY(conexao_id,conversa_id));
      CREATE TABLE IF NOT EXISTS fluxo_transferencias (
        id INTEGER PRIMARY KEY, origem_id INTEGER NOT NULL REFERENCES atendimentos(id),
        conexao_id INTEGER NOT NULL REFERENCES gestao_conexoes(id), departamento_id INTEGER NOT NULL REFERENCES departamentos(id),
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id), motivo TEXT NOT NULL, criado REAL NOT NULL,
        iniciado_id INTEGER REFERENCES atendimentos(id));
      CREATE TABLE IF NOT EXISTS fluxo_notificacoes (
        id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), atendimento_id INTEGER NOT NULL REFERENCES atendimentos(id),
        mensagem_id TEXT NOT NULL, criado REAL NOT NULL, lida INTEGER NOT NULL DEFAULT 0,
        UNIQUE(usuario_id,atendimento_id,mensagem_id));
      CREATE TABLE IF NOT EXISTS fluxo_comandos (
        id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        conexao_id INTEGER NOT NULL REFERENCES gestao_conexoes(id), tipo TEXT NOT NULL,
        dados TEXT NOT NULL, criado REAL NOT NULL, estado TEXT NOT NULL DEFAULT 'aguardando', resultado TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS fluxo_config (id INTEGER PRIMARY KEY CHECK(id=1), inicio REAL NOT NULL);
    ''')
    # Automatic routing begins at this migration, never by importing past chat messages.
    db.execute('INSERT OR IGNORE INTO fluxo_config VALUES (1,?)', (time.time(),))

def register_workflow(bp, connect, api):
    fail, payload, ident, clean, admin, attendance, audit = [api[k] for k in ('fail','payload','ident','clean','admin','attendance','audit')]

    def active(a): return a['status'] in ACTIVE
    def queue(db, kind, connection, data):
        pending=db.execute("SELECT count(*) FROM fluxo_comandos WHERE estado IN ('aguardando','executando')").fetchone()[0]
        if pending>=100: raise ValueError('Aguarde as operações pendentes terminarem.')
        cid=db.execute('INSERT INTO fluxo_comandos(usuario_id,conexao_id,tipo,dados,criado) VALUES (?,?,?,?,?)',
          (g.user['id'],connection,kind,json.dumps(data,ensure_ascii=False),time.time())).lastrowid
        return jsonify(ok=True,comando_id=cid),202

    def notify(db, a, mid):
        # One assigned owner; supervisors view queues but do not receive every client's alert.
        db.execute('INSERT OR IGNORE INTO fluxo_notificacoes(usuario_id,atendimento_id,mensagem_id,criado) VALUES (?,?,?,?)',
          (a['usuario_id'],a['id'],mid,time.time()))

    def company_for(db, phone):
        return [r[0] for r in db.execute('''SELECT DISTINCT v.empresa_id FROM vinculos v JOIN contatos c ON c.id=v.contato_id
          WHERE replace(replace(replace(replace(replace(c.telefone,'+',''),' ',''),'-',''),'(',''),')','') IN (?,?)''',
          (phone,phone[2:] if phone.startswith('55') else phone))]

    def owner(db, dep, company):
        if not company:return None
        rows=db.execute('''SELECT u.* FROM usuarios u JOIN usuario_empresas e ON e.usuario_id=u.id
          WHERE u.ativo=1 AND u.departamento_id=? AND e.departamento_id=? AND e.empresa_id=?''',(dep,dep,company)).fetchall()
        return rows[0] if len(rows)==1 else None

    def make_attendance(db, connection, chat, name, dep, company, user, stamp, subject='Atendimento via WhatsApp', origin=None):
        d=db.execute('SELECT * FROM departamentos WHERE id=? AND ativo=1',(dep,)).fetchone()
        c=db.execute('SELECT * FROM gestao_conexoes WHERE id=?',(connection,)).fetchone()
        comp=db.execute('SELECT * FROM empresas WHERE id=?',(company,)).fetchone() if company else None
        aid=db.execute('''INSERT INTO atendimentos(conexao_id,conversa_id,contato_nome,empresa_id,empresa_nome,empresa_codigo,
          numero,departamento_entrada,entrada_nome,departamento_atual,atual_nome,usuario_id,usuario_nome,iniciado,assunto,origem_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
          (connection,chat,name,company,comp['nome'] if comp else '',comp['codigo'] if comp else '',c['numero'],dep,d['nome'],dep,d['nome'],user['id'],user['nome'],stamp,subject,origin)).lastrowid
        db.execute('INSERT INTO atendimento_eventos(atendimento_id,tipo,usuario_id,usuario_nome,horario,dados) VALUES (?,?,?,?,?,?)',
          (aid,'abertura',user['id'],user['nome'],time.time(),json.dumps({'automatica':True,'origem_id':origin})))
        return dict(db.execute('SELECT * FROM atendimentos WHERE id=?',(aid,)).fetchone())

    def linked_messages(db,a):
        db.execute('''UPDATE fluxo_mensagens SET atendimento_id=? WHERE conexao_id=? AND conversa_id=? AND atendimento_id IS NULL''',
          (a['id'],a['conexao_id'],a['conversa_id']))
        for row in db.execute('SELECT * FROM fluxo_mensagens WHERE atendimento_id=?',(a['id'],)).fetchall():
            db.execute('INSERT OR REPLACE INTO atendimento_mensagens VALUES (?,?,?,?)',(a['id'],row['mensagem_id'],row['timestamp'],row['dados']))
            if not json.loads(row['dados']).get('fromMe'):notify(db,a,row['mensagem_id'])

    def ingest(db,data, send_context=None):
        conn=ident(data.get('conexao_id'));chat=clean(data.get('conversa_id'),'a conversa',100)
        if not re.fullmatch(r'\d+(?:-\d+)?@(?:c\.us|lid|g\.us)',chat):raise ValueError('Conversa inválida.')
        m=data.get('mensagem');phone=re.sub(r'\D','',str(data.get('telefone','')))
        if not isinstance(m,dict) or not isinstance(m.get('timestamp'),(int,float)) or not isinstance(m.get('id'),str):raise ValueError('Mensagem inválida.')
        mid=clean(m['id'],'o identificador da mensagem',300);stamp=float(m['timestamp'])
        connection=db.execute('SELECT * FROM gestao_conexoes WHERE id=?',(conn,)).fetchone()
        if not connection or connection['estado']=='divergente':raise ValueError('Conexão inválida ou número divergente.')
        if connection['estado']!='conectado' or not connection['numero']:raise ValueError('Aguarde a identificação do número conectado.')
        photo=m.pop('contactPhoto',None)
        if isinstance(photo,str) and photo.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')) and len(photo)<2*1024*1024:
            db.execute('INSERT OR REPLACE INTO fluxo_contatos VALUES (?,?,?)',(conn,chat,photo))
        existing=db.execute('SELECT * FROM fluxo_mensagens WHERE conexao_id=? AND mensagem_id=?',(conn,mid)).fetchone()
        if existing:
            # Acknowledgement/name updates never reopen a completed attendance.
            prior=json.loads(existing['dados'])
            if not m.get('reply'):m['reply']=prior.get('reply')
            if not m.get('contactPhoto'):m['contactPhoto']=prior.get('contactPhoto')
            if existing['atendimento_id']:
                closed=db.execute('SELECT status FROM atendimentos WHERE id=?',(existing['atendimento_id'],)).fetchone()
                if closed and closed['status']=='encerrado':m=dict(prior,ack=max(int(prior.get('ack') or 0),int(m.get('ack') or 0)))
            db.execute('UPDATE fluxo_mensagens SET dados=? WHERE conexao_id=? AND mensagem_id=?',(json.dumps(m,ensure_ascii=False),conn,mid))
            if existing['atendimento_id']:
                db.execute('UPDATE atendimento_mensagens SET dados=? WHERE atendimento_id=? AND mensagem_id=?',
                  (json.dumps(m,ensure_ascii=False),existing['atendimento_id'],mid))
            if send_context and not existing['atendimento_id']:
                user=owner(db,send_context['departamento_id'],send_context.get('empresa_id')) or db.execute('SELECT * FROM usuarios WHERE id=?',(send_context['usuario_id'],)).fetchone()
                a=make_attendance(db,conn,chat,existing['nome'],send_context['departamento_id'],send_context.get('empresa_id'),user,existing['timestamp'],send_context.get('assunto','Atendimento via WhatsApp'),send_context.get('origem_id'))
                linked_messages(db,a)
                return a['id']
            return existing['atendimento_id']
        if stamp < db.execute('SELECT inicio FROM fluxo_config WHERE id=1').fetchone()[0]-1:return None
        a=db.execute("SELECT * FROM atendimentos WHERE conexao_id=? AND conversa_id=? AND status IN ('aberto','pendencia','documentacao')",(conn,chat)).fetchone()
        contact=db.execute("SELECT nome FROM contatos WHERE replace(replace(replace(replace(replace(telefone,'+',''),' ',''),'-',''),'(',''),')','') IN (?,?)",(phone,phone[2:] if phone.startswith('55') else phone)).fetchone()
        name=str(contact['nome'] if contact else data.get('nome') or phone or chat)[:200]
        if not a:
            departments=[r[0] for r in db.execute('SELECT id FROM departamentos WHERE ativo=1 AND conexao_id=?',(conn,))]
            companies=company_for(db,phone)
            dep=departments[0] if len(departments)==1 else None
            company=companies[0] if len(companies)==1 else None
            user=owner(db,dep,company) if dep else None
            if company and not dep:
                candidates=[(candidate,owner(db,candidate,company)) for candidate in departments]
                candidates=[(candidate,responsible) for candidate,responsible in candidates if responsible]
                if len(candidates)==1:dep,user=candidates[0]
            if send_context:
                dep=send_context['departamento_id'];company=send_context.get('empresa_id');user=owner(db,dep,company) or db.execute('SELECT * FROM usuarios WHERE id=?',(send_context['usuario_id'],)).fetchone()
            if user:a=make_attendance(db,conn,chat,name,dep,company,user,stamp,send_context.get('assunto','Atendimento via WhatsApp') if send_context else 'Atendimento via WhatsApp',send_context.get('origem_id') if send_context else None)
        db.execute('INSERT INTO fluxo_mensagens VALUES (?,?,?,?,?,?,?,?)',(conn,mid,chat,phone,name,stamp,json.dumps(m,ensure_ascii=False),a['id'] if a else None))
        if a:linked_messages(db,a)
        # An incoming message starts the linked destination attendance and resolves its task.
        if a:
            db.execute('''UPDATE fluxo_transferencias SET iniciado_id=? WHERE iniciado_id IS NULL AND conexao_id=?
              AND departamento_id=? AND usuario_id=? AND origem_id IN (SELECT id FROM atendimentos WHERE conversa_id=? AND empresa_id IS ?)''',
              (a['id'],conn,a['departamento_atual'],a['usuario_id'],chat,a['empresa_id']))
        return a['id'] if a else None

    def close(db,a,summary,kind='encerramento'):
        number=db.execute('SELECT ultimo FROM protocolo_sequencia WHERE id=1').fetchone()[0]+1
        db.execute('UPDATE protocolo_sequencia SET ultimo=? WHERE id=1',(number,))
        db.execute("UPDATE atendimentos SET status='encerrado',encerrado=?,protocolo=?,resumo=? WHERE id=?",(time.time(),number,summary,a['id']))
        audit(db,a['id'],kind,{'protocolo':number,'resumo':summary})
        return number

    @bp.route('/conexoes',methods=['GET','POST'])
    def connections():
        with connect() as db:
            if request.method=='POST':
                if not admin():return fail('Somente administradores configuram conexões.',403)
                name=clean(payload().get('nome'),'o nome da conexão',80)
                cid=db.execute('INSERT INTO gestao_conexoes(nome,habilitada) VALUES (?,0)',(name,)).lastrowid
                return jsonify(ok=True,id=cid),201
            rows=[]
            for row in db.execute('SELECT * FROM gestao_conexoes ORDER BY id'):
                item=dict(row);item['departamentos']=[dict(r) for r in db.execute('SELECT id,nome FROM departamentos WHERE conexao_id=?',(row['id'],))]
                if not admin():item.pop('qr',None)
                rows.append(item)
            return jsonify(rows)

    @bp.post('/departamentos/<int:dep>/conexao')
    def link_connection(dep):
        if not admin():return fail('Somente administradores configuram departamentos.',403)
        data=payload();cid=ident(data.get('conexao_id')) if data.get('conexao_id') else 0
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM departamentos WHERE id=?',(dep,)).fetchone():return fail('Departamento inexistente.',404)
            if db.execute("SELECT 1 FROM atendimentos WHERE departamento_atual=? AND status IN ('aberto','pendencia','documentacao')",(dep,)).fetchone() or db.execute('SELECT 1 FROM fluxo_transferencias WHERE departamento_id=? AND iniciado_id IS NULL',(dep,)).fetchone():return fail('Finalize ou transfira as demandas antes de alterar o número.',409)
            if cid and not db.execute('SELECT 1 FROM gestao_conexoes WHERE id=?',(cid,)).fetchone():raise ValueError('Conexão inexistente.')
            # 0 is an explicit unlinked department, no fake WhatsApp session.
            if not cid:
                db.execute("INSERT OR IGNORE INTO gestao_conexoes(id,nome,habilitada) VALUES (0,'Sem número',0)")
            db.execute('UPDATE departamentos SET conexao_id=? WHERE id=?',(cid,dep))
            return jsonify(ok=True)

    @bp.post('/conexoes/<int:cid>/<action>')
    def connection_action(cid,action):
        if not admin():return fail('Somente administradores conectam ou desconectam números.',403)
        if action not in ('conectar','desconectar'):raise ValueError('Ação inválida.')
        with connect() as db:
            if cid<1 or not db.execute('SELECT 1 FROM gestao_conexoes WHERE id=?',(cid,)).fetchone():raise ValueError('Conexão inexistente.')
            if db.execute("SELECT 1 FROM fluxo_comandos WHERE conexao_id=? AND tipo IN ('conectar','desconectar') AND estado IN ('aguardando','executando')",(cid,)).fetchone():return fail('Já existe uma operação de conexão em andamento.',409)
            db.execute('UPDATE gestao_conexoes SET habilitada=? WHERE id=?',(int(action=='conectar'),cid))
            return queue(db,action,cid,{})

    def pending_owner(db,conn,companies):
        if not companies:return None
        departments=[r[0] for r in db.execute('SELECT id FROM departamentos WHERE ativo=1 AND conexao_id=?',(conn,))]
        resolved=[]
        for company in companies:
            candidates=[owner(db,dep,company) for dep in departments]
            candidates=[candidate for candidate in candidates if candidate]
            if len(candidates)!=1:return None
            resolved.append(candidates[0]['id'])
        return resolved[0] if len(set(resolved))==1 else None

    def triage_rows(db):
        args=[];where=''
        if not admin():
            where=' AND m.conexao_id IN (SELECT conexao_id FROM departamentos WHERE id=? AND ativo=1)';args=[g.user['departamento_id']]
        rows=[dict(r) for r in db.execute("""SELECT m.conexao_id,m.conversa_id,max(m.nome) nome,max(m.telefone) telefone,
          count(*) mensagens,min(m.timestamp) inicio,
          max(CASE WHEN coalesce(json_extract(m.dados,'$.fromMe'),0)=0 THEN m.rowid ELSE 0 END) aviso_id
          FROM fluxo_mensagens m WHERE atendimento_id IS NULL"""+where+
          ' GROUP BY m.conexao_id,m.conversa_id HAVING aviso_id>0 ORDER BY inicio LIMIT 100',args)]
        for row in rows:
            row['empresas']=company_for(db,row['telefone'])
            row['responsavel_id']=pending_owner(db,row['conexao_id'],row['empresas'])
            row['notificar']=row['responsavel_id']==g.user['id'] if row['responsavel_id'] else bool(admin() or g.user['triagem'])
            latest=db.execute("SELECT dados FROM fluxo_mensagens WHERE rowid=?",(row['aviso_id'],)).fetchone()
            message=json.loads(latest[0]);row['previa']=str(message.get('body') or message.get('mediaLabel') or 'Nova mensagem')[:300]
        return rows if admin() or g.user['triagem'] else [row for row in rows if row['responsavel_id']==g.user['id']]

    @bp.get('/triagem')
    def triage():
        with connect() as db:
            rows=triage_rows(db)
            if not admin() and not g.user['triagem'] and not rows:return fail('Triagem não autorizada.',403)
            return jsonify(rows)

    @bp.post('/triagem/classificar')
    def classify():
        data=payload();conn=ident(data.get('conexao_id'));dep=ident(data.get('departamento_id'));company=ident(data.get('empresa_id'));chat=clean(data.get('conversa_id'),'a conversa',100)
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not admin() and not g.user['triagem'] and not any(row['conexao_id']==conn and row['conversa_id']==chat for row in triage_rows(db)):return fail('Fila não autorizada.',403)
            if not admin() and not db.execute('SELECT 1 FROM departamentos WHERE id=? AND conexao_id=?',(g.user['departamento_id'],conn)).fetchone():return fail('Fila não autorizada.',403)
            if not db.execute('SELECT 1 FROM departamentos WHERE id=? AND conexao_id=? AND ativo=1',(dep,conn)).fetchone():raise ValueError('Departamento fora desta conexão.')
            user=owner(db,dep,company)
            if not user:return fail('Defina um único responsável ativo para essa empresa no departamento.',409)
            if not admin() and not g.user['triagem'] and user['id']!=g.user['id']:return fail('Responsável fora da sua permissão.',403)
            row=db.execute('SELECT * FROM fluxo_mensagens WHERE conexao_id=? AND conversa_id=? AND atendimento_id IS NULL ORDER BY timestamp LIMIT 1',(conn,chat)).fetchone()
            if not row:return fail('Fila já classificada.',409)
            if db.execute("SELECT 1 FROM atendimentos WHERE conexao_id=? AND conversa_id=? AND status IN ('aberto','pendencia','documentacao')",(conn,chat)).fetchone():return fail('Já existe atendimento ativo.',409)
            a=make_attendance(db,conn,chat,row['nome'],dep,company,user,row['timestamp'])
            linked_messages(db,a);audit(db,a['id'],'classificacao',{'empresa_id':company,'departamento_id':dep})
            return jsonify(ok=True,id=a['id'])

    @bp.post('/atendimentos/<int:aid>/situacao')
    def situation(aid):
        data=payload();state=data.get('status');note=str(data.get('pendencia','')).strip()[:2000];deadline=str(data.get('prazo',''))[:10]
        if state not in ACTIVE:raise ValueError('Situação inválida.')
        if state!='aberto' and not note:raise ValueError('Descreva a pendência ou os documentos aguardados.')
        if deadline and not re.fullmatch(r'\d{4}-\d{2}-\d{2}',deadline):raise ValueError('Prazo inválido.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');a=attendance(db,aid)
            if not a:return fail('Atendimento não autorizado.',403)
            if not active(a):return fail('Atendimento concluído.',409)
            db.execute('UPDATE atendimentos SET status=?,pendencia=?,prazo=? WHERE id=?',(state,note,deadline,aid))
            audit(db,aid,'situacao',{'status':state,'pendencia':note,'prazo':deadline})
            return jsonify(ok=True)

    @bp.post('/atendimentos/<int:aid>/encaminhar')
    def forward(aid):
        data=payload();dep=ident(data.get('departamento_id'));uid=ident(data.get('usuario_id'));reason=clean(data.get('motivo'),'o motivo',2000)
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');a=attendance(db,aid)
            if not a:return fail('Atendimento não autorizado.',403)
            if not active(a):return fail('Atendimento concluído.',409)
            d=db.execute('SELECT * FROM departamentos WHERE id=? AND ativo=1',(dep,)).fetchone()
            u=db.execute('SELECT * FROM usuarios WHERE id=? AND ativo=1 AND departamento_id=?',(uid,dep)).fetchone()
            if not d or not u or not d['conexao_id']:raise ValueError('Destino sem responsável ativo ou número vinculado.')
            if a['empresa_id'] and not db.execute('SELECT 1 FROM usuario_empresas WHERE usuario_id=? AND departamento_id=? AND empresa_id=?',(uid,dep,a['empresa_id'])).fetchone():return fail('Destinatário não é responsável pela empresa.',403)
            if not a['empresa_id'] and not u['triagem']:return fail('Destinatário sem permissão de triagem.',403)
            if a['usuario_id']==uid and a['departamento_atual']==dep:raise ValueError('Escolha outro responsável.')
            if d['conexao_id']==a['conexao_id']:
                db.execute('UPDATE atendimentos SET departamento_atual=?,atual_nome=?,usuario_id=?,usuario_nome=? WHERE id=?',(dep,d['nome'],uid,u['nome'],aid))
                audit(db,aid,'transferencia',{'origem':a['atual_nome'],'destino':d['nome'],'para':u['nome'],'motivo':reason})
                notify(db,dict(db.execute('SELECT * FROM atendimentos WHERE id=?',(aid,)).fetchone()),'transferencia:'+str(time.time_ns()))
                return jsonify(ok=True,mesmo_numero=True)
            protocol=close(db,a,'Transferido para '+d['nome']+': '+reason,'transferencia_outro_numero')
            tid=db.execute('INSERT INTO fluxo_transferencias(origem_id,conexao_id,departamento_id,usuario_id,motivo,criado) VALUES (?,?,?,?,?,?)',(aid,d['conexao_id'],dep,uid,reason,time.time())).lastrowid
            return jsonify(ok=True,mesmo_numero=False,transferencia_id=tid,protocolo=protocol)

    @bp.get('/avisos')
    def notices():
        with connect() as db:
            transfers=[dict(r) for r in db.execute('''SELECT t.*,a.contato_nome,a.empresa_nome,a.conversa_id,a.empresa_id,a.atual_nome origem_departamento,
              c.numero FROM fluxo_transferencias t JOIN atendimentos a ON a.id=t.origem_id JOIN gestao_conexoes c ON c.id=t.conexao_id
              WHERE t.usuario_id=? AND t.iniciado_id IS NULL ORDER BY t.criado''',(g.user['id'],))]
            notices=[dict(r) for r in db.execute('''SELECT n.*,a.contato_nome,a.empresa_nome FROM fluxo_notificacoes n JOIN atendimentos a ON a.id=n.atendimento_id
              WHERE n.usuario_id=? AND n.lida=0 AND a.usuario_id=? AND a.departamento_atual IS ? ORDER BY n.criado DESC LIMIT 50''',
              (g.user['id'],g.user['id'],g.user['departamento_id']))] if not admin() else [dict(r) for r in db.execute('''SELECT n.*,a.contato_nome,a.empresa_nome FROM fluxo_notificacoes n JOIN atendimentos a ON a.id=n.atendimento_id WHERE n.usuario_id=? AND n.lida=0 ORDER BY n.criado DESC LIMIT 50''',(g.user['id'],))]
            return jsonify(transferencias=transfers,mensagens=notices,triagem=triage_rows(db))

    @bp.post('/avisos/<int:nid>/ler')
    def read_notice(nid):
        with connect() as db:db.execute('UPDATE fluxo_notificacoes SET lida=1 WHERE id=? AND usuario_id=?',(nid,g.user['id']))
        return jsonify(ok=True)

    @bp.post('/atendimentos/<int:aid>/lido')
    def read_attendance(aid):
        with connect() as db:
            if not attendance(db,aid):return fail('Atendimento não autorizado.',403)
            db.execute('UPDATE fluxo_notificacoes SET lida=1 WHERE atendimento_id=? AND usuario_id=?',(aid,g.user['id']))
        return jsonify(ok=True)

    def prepare_send(db,data,user):
        aid=ident(data['atendimento_id']) if data.get('atendimento_id') else None
        transfer=ident(data['transferencia_id']) if data.get('transferencia_id') else None
        a=attendance(db,aid) if aid else None
        if aid:
            if not a or not active(a):raise ValueError('Atendimento não autorizado ou concluído.')
            dep=a['departamento_atual'];company=a['empresa_id'];conn=a['conexao_id'];chat=a['conversa_id'];origin=a.get('origem_id')
            if data.get('resposta_id') and not db.execute('SELECT 1 FROM atendimento_mensagens WHERE atendimento_id=? AND mensagem_id=?',(aid,str(data['resposta_id']))).fetchone():raise ValueError('A mensagem respondida não pertence a este atendimento.')
        elif transfer:
            t=db.execute('SELECT * FROM fluxo_transferencias WHERE id=? AND usuario_id=? AND iniciado_id IS NULL',(transfer,user['id'])).fetchone()
            if not t:raise ValueError('Transferência não autorizada ou já iniciada.')
            source=db.execute('SELECT * FROM atendimentos WHERE id=?',(t['origem_id'],)).fetchone()
            dep=t['departamento_id'];company=source['empresa_id'];conn=t['conexao_id'];chat=source['conversa_id'];origin=source['id']
        else:
            if data.get('resposta_id'):raise ValueError('Abra um atendimento ativo para responder a uma mensagem.')
            dep=ident(data.get('departamento_id'));company=ident(data['empresa_id']) if data.get('empresa_id') else None
            d=db.execute('SELECT * FROM departamentos WHERE id=? AND ativo=1',(dep,)).fetchone()
            if not d or (user['perfil']!='admin' and dep!=user['departamento_id']):raise ValueError('Departamento não autorizado.')
            conn=d['conexao_id'];phone=re.sub(r'\D','',str(data.get('telefone','')))
            if not re.fullmatch(r'\d{10,15}',phone):raise ValueError('Telefone inválido; inclua o código do país.')
            chat=phone+'@c.us';origin=None
        if user['perfil']!='admin' and company and not (a and a['usuario_id']==user['id']) and not db.execute('SELECT 1 FROM usuario_empresas WHERE usuario_id=? AND departamento_id=? AND empresa_id=?',(user['id'],dep,company)).fetchone():raise ValueError('Empresa fora da sua responsabilidade.')
        if user['perfil']!='admin' and not company and not user['triagem']:raise ValueError('Selecione uma empresa sob responsabilidade.')
        c=db.execute('SELECT * FROM gestao_conexoes WHERE id=?',(conn,)).fetchone()
        if company and not db.execute('SELECT 1 FROM empresas WHERE id=?',(company,)).fetchone():raise ValueError('Empresa inexistente.')
        if not c or c['estado']!='conectado' or not c['numero'] or not c['habilitada']:raise ValueError('Número indisponível. A mensagem digitada será preservada.')
        if not aid and db.execute("SELECT 1 FROM atendimentos WHERE conexao_id=? AND conversa_id=? AND status IN ('aberto','pendencia','documentacao')",(conn,chat)).fetchone():raise ValueError('Já existe atendimento ativo. Abra a conversa na lista.')
        known=db.execute('SELECT telefone FROM fluxo_mensagens WHERE conexao_id=? AND conversa_id=? ORDER BY timestamp DESC LIMIT 1',(conn,chat)).fetchone()
        phone=known['telefone'] if known else chat.split('@')[0]
        if chat.endswith('@lid') and not known:
            cached=db.execute('SELECT dados FROM wa_conversas WHERE id=?',(chat,)).fetchone()
            if cached:phone=str(json.loads(cached[0]).get('phone') or phone)
        return dict(data,conexao_id=conn,conversa_id=chat,telefone=phone,departamento_id=dep,empresa_id=company,usuario_id=user['id'],origem_id=origin,numero=c['numero'])

    @bp.post('/enviar')
    def send():
        data=payload();text=str(data.get('texto','')).strip()
        media=data.get('midia')
        if not text and not media:raise ValueError('Digite uma mensagem ou selecione um anexo.')
        if len(text)>10000:raise ValueError('Mensagem muito longa.')
        if media:
            if not isinstance(media,dict):raise ValueError('Anexo inválido.')
            try:decoded=base64.b64decode(media.get('data',''),validate=True)
            except Exception:raise ValueError('Anexo inválido.')
            if not decoded or len(decoded)>16*1024*1024:raise ValueError('Arquivo acima de 16 MB ou vazio.')
            if not re.fullmatch(r'[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+',str(media.get('mimetype','')).split(';')[0]):raise ValueError('Formato inválido.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');prepared=prepare_send(db,dict(data,texto=text),g.user)
            return queue(db,'enviar',prepared['conexao_id'],prepared)

    @bp.get('/comandos/<int:cid>')
    def command_status(cid):
        with connect() as db:
            row=db.execute('SELECT estado,resultado FROM fluxo_comandos WHERE id=? AND usuario_id=?',(cid,g.user['id'])).fetchone()
            if not row:return fail('Operação não autorizada.',403)
            return jsonify(estado=row['estado'],resultado=json.loads(row['resultado']))

    @bp.get('/transferencias/<int:tid>/contexto')
    def transfer_context(tid):
        with connect() as db:
            t=db.execute('SELECT * FROM fluxo_transferencias WHERE id=?',(tid,)).fetchone()
            if not t or (not admin() and t['usuario_id']!=g.user['id']):return fail('Contexto não autorizado.',403)
            a=dict(db.execute('SELECT * FROM atendimentos WHERE id=?',(t['origem_id'],)).fetchone())
            rows=[json.loads(r[0]) for r in db.execute('SELECT dados FROM atendimento_mensagens WHERE atendimento_id=? ORDER BY timestamp,mensagem_id LIMIT 500',(a['id'],))]
            return jsonify(atendimento=a,mensagens=rows,motivo=t['motivo'])

    @bp.get('/atendimentos/<int:aid>/origem')
    def origin_context(aid):
        with connect() as db:
            a=attendance(db,aid)
            if not a or not a['origem_id']:return fail('Contexto não autorizado.',403)
            source=db.execute('SELECT * FROM atendimentos WHERE id=?',(a['origem_id'],)).fetchone()
            messages=[json.loads(r[0]) for r in db.execute('SELECT dados FROM atendimento_mensagens WHERE atendimento_id=? ORDER BY timestamp,mensagem_id LIMIT 500',(source['id'],))]
            return jsonify(atendimento=dict(source),mensagens=messages)

    # Trusted Electron worker routes; no renderer receives the shared secret.
    @bp.get('/ponte/configuracao')
    def bridge_config():
        with connect() as db:return jsonify([dict(r) for r in db.execute('SELECT id,numero,habilitada FROM gestao_conexoes WHERE id>0')])

    @bp.post('/ponte/estado')
    def bridge_state():
        data=payload();cid=ident(data.get('conexao_id'));number=re.sub(r'\D','',str(data.get('numero','')));state=data.get('estado')
        if state not in ('conectado','desconectado','aguardando','autenticado','qr','erro'):raise ValueError('Estado inválido.')
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');old=db.execute('SELECT * FROM gestao_conexoes WHERE id=?',(cid,)).fetchone()
            if not old:raise ValueError('Conexão inexistente.')
            if number and (len(number)<10 or len(number)>15):raise ValueError('Número inválido.')
            duplicate=db.execute('SELECT id FROM gestao_conexoes WHERE numero=? AND id<>?',(number,cid)).fetchone() if number else None
            if (number and old['numero'] and old['numero']!=number) or duplicate:
                db.execute("UPDATE gestao_conexoes SET estado='divergente',qr='',erro=? WHERE id=?",('Número já utilizado ou diferente do cadastro. Vincule à conexão existente.',cid))
                return fail('Número divergente ou duplicado.',409)
            db.execute('UPDATE gestao_conexoes SET numero=?,estado=?,qr=?,erro=?,atualizado=? WHERE id=?',
              (number or old['numero'],state,str(data.get('qr',''))[:100000],str(data.get('erro',''))[:1000],time.time(),cid))
            return jsonify(ok=True)

    @bp.post('/ponte/mensagem')
    def bridge_message():
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');aid=ingest(db,payload())
            return jsonify(ok=True,atendimento_id=aid)

    @bp.post('/ponte/presenca')
    def bridge_presence():
        data=payload();cid=ident(data.get('conexao_id'));values=data.get('valores',{})
        if not isinstance(values,dict) or len(values)>100:raise ValueError('Indicadores inválidos.')
        with connect() as db:
            db.execute('DELETE FROM fluxo_presenca WHERE conexao_id=?',(cid,))
            for chat,value in values.items():
                if isinstance(value,dict) and value.get('type') in ('typing','recording') and re.fullmatch(r'\d+@(?:c\.us|lid)',chat):
                    db.execute('INSERT INTO fluxo_presenca VALUES (?,?,?,?)',(cid,chat,value['type'],time.time()+25))
        return jsonify(ok=True)

    @bp.post('/ponte/midia')
    def bridge_media():
        data=payload();conn=ident(data.get('conexao_id'));mid=clean(data.get('mensagem_id'),'a mensagem',300);media=data.get('midia')
        if not isinstance(media,dict) or len(str(media.get('data','')))>24*1024*1024:raise ValueError('Mídia inválida.')
        with connect() as db:
            if not db.execute('SELECT 1 FROM fluxo_mensagens WHERE conexao_id=? AND mensagem_id=?',(conn,mid)).fetchone():return fail('Mensagem desconhecida.',404)
            db.execute('INSERT OR REPLACE INTO fluxo_midias VALUES (?,?,?)',(conn,mid,json.dumps(media)))
        return jsonify(ok=True)

    @bp.get('/atendimentos/<int:aid>/arquivo/<path:mid>')
    def scoped_media(aid,mid):
        with connect() as db:
            a=attendance(db,aid)
            if not a or not db.execute('SELECT 1 FROM atendimento_mensagens WHERE atendimento_id=? AND mensagem_id=?',(aid,mid)).fetchone():return fail('Arquivo não autorizado.',403)
            row=db.execute('SELECT dados FROM fluxo_midias WHERE conexao_id=? AND mensagem_id=?',(a['conexao_id'],mid)).fetchone()
            if not row and a['conexao_id']==1:row=db.execute('SELECT dados FROM wa_midias WHERE mensagem_id=?',(mid,)).fetchone()
            if not row:return fail('Arquivo ainda não carregado.',404)
            return jsonify(json.loads(row[0]))

    @bp.post('/ponte/comandos')
    def bridge_commands():
        data=payload()
        with connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if data.get('recuperar'):
                # Unknown delivery after process interruption must not silently resend.
                db.execute("UPDATE fluxo_comandos SET estado='erro',resultado=? WHERE estado='executando'",(json.dumps({'erro':'Operação interrompida. Confira a conversa antes de tentar novamente.'}),))
            row=db.execute("SELECT * FROM fluxo_comandos WHERE estado='aguardando' ORDER BY id LIMIT 1").fetchone()
            if not row:return jsonify(comando=None)
            user=db.execute('SELECT * FROM usuarios WHERE id=? AND ativo=1',(row['usuario_id'],)).fetchone()
            if not user:
                db.execute("UPDATE fluxo_comandos SET estado='erro',resultado=? WHERE id=?",(json.dumps({'erro':'Usuário desativado.'}),row['id']))
                return jsonify(comando=None)
            g.user=dict(user);content=json.loads(row['dados'])
            try:
                if row['tipo']=='enviar':content=prepare_send(db,content,g.user)
                elif not admin():raise ValueError('Operação administrativa não autorizada.')
            except ValueError as e:
                db.execute("UPDATE fluxo_comandos SET estado='erro',resultado=?,dados='{}' WHERE id=?",(json.dumps({'erro':str(e)}),row['id']))
                return jsonify(comando=None)
            db.execute("UPDATE fluxo_comandos SET estado='executando' WHERE id=?",(row['id'],))
            return jsonify(comando=dict(id=row['id'],conexao_id=row['conexao_id'],tipo=row['tipo'],dados=content))

    @bp.post('/ponte/comandos/<int:cid>/resultado')
    def bridge_result(cid):
        data=payload()
        with connect() as db:
            db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM fluxo_comandos WHERE id=?',(cid,)).fetchone()
            if not row or row['estado']!='executando':return fail('Operação já concluída ou inválida.',409)
            result=data.get('resultado',{});content=json.loads(row['dados'])
            if data.get('ok') and row['tipo']=='enviar':
                message=data.get('mensagem')
                if not isinstance(message,dict):raise ValueError('Confirmação da mensagem ausente.')
                if content.get('resposta_id') and content.get('atendimento_id'):
                    quoted=db.execute('SELECT dados FROM atendimento_mensagens WHERE atendimento_id=? AND mensagem_id=?',(content['atendimento_id'],str(content['resposta_id']))).fetchone()
                    if quoted:
                        original=json.loads(quoted[0]);message['reply']=dict(id=original['id'],body=original.get('body') or original.get('mediaLabel'),author='Você' if original.get('fromMe') else original.get('authorName') or 'Contato')
                aid=ingest(db,dict(conexao_id=row['conexao_id'],conversa_id=content['conversa_id'],telefone=content.get('telefone') or content['conversa_id'].split('@')[0],nome=content.get('nome') or content['conversa_id'],mensagem=message),content)
                result=dict(result,atendimento_id=aid)
                if content.get('transferencia_id') and aid:db.execute('UPDATE fluxo_transferencias SET iniciado_id=? WHERE id=?',(aid,content['transferencia_id']))
            db.execute('UPDATE fluxo_comandos SET estado=?,resultado=?,dados=? WHERE id=?',
              ('concluido' if data.get('ok') else 'erro',json.dumps(result,ensure_ascii=False),json.dumps({k:v for k,v in content.items() if k!='midia'},ensure_ascii=False),cid))
            return jsonify(ok=True)

    return {'close':close}
