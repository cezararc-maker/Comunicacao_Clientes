import os,sys,tempfile,unittest,json,time
from contextlib import closing
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app as server
class ManagementTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.old=server.DB;server.DB=Path(self.tmp.name)/'test.db';self.oldtoken=os.environ.get('WA_SYNC_TOKEN');os.environ['WA_SYNC_TOKEN']='test-management'
  server.init_db();self.admin=server.app.test_client();self.other=server.app.test_client();self.headers={'X-Sync-Token':'test-management'}
  with server.connect() as db:
   db.execute("INSERT INTO empresas VALUES (1,'001','Empresa Original','CPF','12345678901')")
   db.execute("INSERT INTO contatos VALUES (1,'Ana','+5567996373431')")
   db.execute("INSERT INTO vinculos VALUES (1,1,'Financeiro')")
  self.chat={'id':'5567996373431@c.us','name':'Ana','messages':[{'id':'old','timestamp':time.time()-100,'body':'Mensagem anterior','fromMe':False}]}
  self.admin.post('/api/whatsapp/historico',headers=self.headers,json={'conversations':[self.chat]})
  self.assertEqual(self.admin.post('/api/gestao/configurar',json={'nome':'Admin','login':'admin','senha':'Senha-teste-123'}).status_code,200)
  self.assertEqual(self.admin.post('/api/gestao/conexao-atual',headers=self.headers,json={'numero':'5567000000000','estado':'conectado'}).status_code,200)
 def tearDown(self):
  server.DB=self.old;self.tmp.cleanup()
  if self.oldtoken is None:os.environ.pop('WA_SYNC_TOKEN',None)
  else:os.environ['WA_SYNC_TOKEN']=self.oldtoken
 def user(self,login,department,companies=[1],triage=False):
  result=self.admin.post('/api/gestao/usuarios',json={'nome':login,'login':login,'senha':'Senha-teste-123','perfil':'atendente','departamento_id':department,'empresas':companies,'triagem':triage});self.assertEqual(result.status_code,200,result.json);return result.json['id']
 def open(self,client,department=6,company=1):
  return client.post('/api/gestao/atendimentos',json={'conversa_id':self.chat['id'],'departamento_id':department,'empresa_id':company,'assunto':'Documento solicitado'})
 def test_permissions_transfer_close_protocol_snapshot(self):
  source_id=self.user('financeiro',6);destination_id=self.user('fiscal',4)
  self.other.post('/api/gestao/login',json={'login':'financeiro','senha':'Senha-teste-123'})
  fiscal=server.app.test_client();fiscal.post('/api/gestao/login',json={'login':'fiscal','senha':'Senha-teste-123'})
  self.assertEqual(self.other.post('/api/gestao/usuarios',json={}).status_code,403)
  self.assertEqual(self.open(self.other,4).status_code,403)
  first=self.open(self.other);self.assertEqual(first.status_code,201,first.json);aid=first.json['id']
  self.assertEqual(self.open(self.admin).status_code,409)
  self.assertEqual(fiscal.get('/api/gestao/atendimentos').json['total'],0)
  self.assertEqual(fiscal.get(f'/api/gestao/atendimentos/{aid}').status_code,403)
  self.assertEqual(self.other.get('/api/gestao/legado').status_code,403)
  self.chat['messages']=[{'id':'new','timestamp':time.time()+0.01,'body':'Resposta registrada','reply':{'body':'Pedido','author':'Ana'},'ack':3,'fromMe':True}]
  self.admin.post('/api/whatsapp/historico',headers=self.headers,json={'conversations':[self.chat]})
  detail=self.other.get(f'/api/gestao/atendimentos/{aid}').json;self.assertEqual([m['id'] for m in detail['mensagens']],['new'])
  cached={'mimetype':'audio/ogg','data':'YWJj'};self.assertEqual(self.admin.post('/api/whatsapp/midia/new',headers=self.headers,json=cached).status_code,200)
  self.assertEqual(self.other.get(f'/api/gestao/atendimentos/{aid}/midia/new').json,cached);self.assertEqual(fiscal.get(f'/api/gestao/atendimentos/{aid}/midia/new').status_code,403)
  self.assertEqual(self.other.get(f'/api/gestao/atendimentos/{aid}/midia/old').status_code,403)
  self.assertEqual(self.other.post(f'/api/gestao/atendimentos/{aid}/transferir',json={'usuario_id':destination_id,'departamento_id':4,'motivo':'Orientação fiscal'}).status_code,200)
  self.assertEqual(self.other.get(f'/api/gestao/atendimentos/{aid}').status_code,403)
  finished=fiscal.post(f'/api/gestao/atendimentos/{aid}/encerrar',json={'resumo':'Documentação conferida'});self.assertEqual(finished.json['protocolo'],1)
  self.assertEqual(fiscal.post(f'/api/gestao/atendimentos/{aid}/encerrar',json={'resumo':'Repetido'}).json['protocolo'],1)
  with server.connect() as db:
   db.execute("UPDATE empresas SET nome='Empresa Nova' WHERE id=1");db.execute("UPDATE departamentos SET nome='Fiscal Novo' WHERE id=4");db.execute("UPDATE usuarios SET nome='Nome Novo' WHERE id=?",(destination_id,))
  server.init_db();detail=fiscal.get(f'/api/gestao/atendimentos/{aid}').json
  self.assertEqual(detail['atendimento']['empresa_nome'],'Empresa Original');self.assertEqual(detail['atendimento']['entrada_nome'],'Financeiro');self.assertEqual(detail['atendimento']['atual_nome'],'Fiscal');self.assertEqual(detail['atendimento']['usuario_nome'],'fiscal')
  self.assertEqual(len(detail['eventos']),3)
  self.chat['messages']=[{'id':'later','timestamp':time.time()+20,'body':'Mensagem posterior'}];self.admin.post('/api/whatsapp/historico',headers=self.headers,json={'conversations':[self.chat]})
  self.assertEqual(fiscal.get(f'/api/gestao/atendimentos/{aid}').json['total_mensagens'],1)
  second=self.open(fiscal,4);self.assertEqual(second.status_code,201);second_id=second.json['id'];self.assertEqual(fiscal.post(f'/api/gestao/atendimentos/{second_id}/encerrar',json={'resumo':'Segundo'}).json['protocolo'],2)
  self.assertEqual(self.admin.get('/api/gestao/atendimentos?status=encerrado&protocolo=1').json['total'],1)
  self.assertEqual(self.admin.get('/api/gestao/atendimentos?inicio=INVALID').status_code,400)
  with server.connect() as db:self.assertEqual(db.execute('SELECT count(*) FROM departamentos').fetchone()[0],7);self.assertEqual(db.execute('SELECT count(*) FROM wa_mensagens').fetchone()[0],3);self.assertEqual(db.execute('SELECT funcao FROM vinculos').fetchone()[0],'Financeiro');self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
 def test_existing_database_backup_and_additive_migration(self):
  import sqlite3
  server.DB=Path(self.tmp.name)/'existing.db'
  with closing(sqlite3.connect(server.DB)) as db, db:
   db.executescript("CREATE TABLE wa_conversas(id TEXT PRIMARY KEY,dados TEXT NOT NULL); CREATE TABLE wa_mensagens(id TEXT PRIMARY KEY,conversa_id TEXT NOT NULL,timestamp REAL NOT NULL,dados TEXT NOT NULL);")
   db.execute('INSERT INTO wa_conversas VALUES (?,?)',('old@c.us','{}'));db.execute('INSERT INTO wa_mensagens VALUES (?,?,?,?)',('keep','old@c.us',1,'{}'))
  server.init_db();files=list((server.DB.parent/'backups').glob('*.db'));self.assertEqual(len(files),1)
  with closing(sqlite3.connect(files[0])) as db:self.assertEqual(db.execute('SELECT id FROM wa_mensagens').fetchone()[0],'keep')
  server.init_db();self.assertEqual(len(list((server.DB.parent/'backups').glob('*.db'))),1)
  with server.connect() as db:self.assertEqual(db.execute('SELECT id FROM wa_mensagens').fetchone()[0],'keep');self.assertEqual(db.execute('SELECT count(*) FROM departamentos').fetchone()[0],7)
 def test_authentication_validation_and_admin_recovery(self):
  anonymous=server.app.test_client();self.assertEqual(anonymous.get('/api/gestao/contexto').status_code,401)
  self.assertEqual(anonymous.post('/api/gestao/configurar',json={'nome':'Novo','login':'novo','senha':'OutraSenha123'}).status_code,409)
  self.assertEqual(anonymous.post('/api/gestao/login',headers={'Origin':'https://example.com'},json={'login':'admin','senha':'Senha-teste-123'}).status_code,403)
  for i in range(10):self.assertEqual(anonymous.post('/api/gestao/login',json={'login':'admin','senha':'errada'}).status_code,401)
  self.assertEqual(anonymous.post('/api/gestao/login',json={'login':'admin','senha':'Senha-teste-123'}).status_code,429)
  with server.connect() as db:db.execute('DELETE FROM gestao_login_limite')
  uid=self.admin.get('/api/gestao/contexto').json['usuario']['id']
  self.assertEqual(self.admin.put(f'/api/gestao/usuarios/{uid}',json={'nome':'Admin','login':'admin','perfil':'atendente','departamento_id':6,'empresas':[]}).status_code,409)
  otherid=self.user('semempresa',6,[])
  user=server.app.test_client();user.post('/api/gestao/login',json={'login':'semempresa','senha':'Senha-teste-123'});self.assertEqual(self.open(user).status_code,403);self.assertEqual(self.open(user,6,None).status_code,403)
  self.assertEqual(self.admin.post('/api/gestao/conexao-atual',json={'estado':'conectado'}).status_code,403)
  self.assertEqual(self.admin.post('/api/gestao/conexao-atual',headers=self.headers,json={'numero':'5567111111111','estado':'conectado'}).status_code,409)
  self.assertEqual(self.open(self.admin).status_code,409)
  with server.connect() as db:
   row=db.execute("SELECT senha_hash FROM usuarios WHERE login='admin'").fetchone();self.assertNotEqual(row[0],'Senha-teste-123');self.assertNotIn('senha_hash',json.dumps(self.admin.get('/api/gestao/usuarios').json));self.assertEqual(db.execute('SELECT numero FROM gestao_conexoes').fetchone()[0],'5567000000000')
  self.admin.post('/api/gestao/sair',json={});self.assertEqual(self.admin.get('/api/gestao/contexto').status_code,401)
if __name__=='__main__':unittest.main()
