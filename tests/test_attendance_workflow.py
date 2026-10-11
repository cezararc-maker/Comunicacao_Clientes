import os,sys,json,time,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app as server

class WorkflowTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.old=server.DB;server.DB=Path(self.temp.name)/'test.db';self.token=os.environ.get('WA_SYNC_TOKEN');os.environ['WA_SYNC_TOKEN']='workflow-test';server.init_db()
  self.admin=server.app.test_client();self.trusted={'X-Sync-Token':'workflow-test'}
  self.admin.post('/api/gestao/configurar',json={'nome':'Admin','login':'admin','senha':'TestSenha123'})
  with server.connect() as db:
   db.execute("INSERT INTO empresas VALUES (1,'01','Empresa A','CPF','11111111111')")
   db.execute("INSERT INTO empresas VALUES (2,'02','Empresa B','CPF','22222222222')")
   db.execute("INSERT INTO contatos VALUES (1,'Cliente','+5567996373431')");db.execute("INSERT INTO vinculos VALUES (1,1,'Diretor')")
   db.execute("INSERT INTO gestao_conexoes(id,nome,habilitada) VALUES (0,'Sem número',0)")
   db.execute("UPDATE departamentos SET conexao_id=0 WHERE id<>6")
  self.source_id,self.source=self.user('financeiro',6,[1],True)
  self.dest_id,self.dest=self.user('fiscal',4,[1])
  self.other_id,self.other=self.user('outro',6,[2])
  self.state(1,'5567000000001');self.chat='5567996373431@c.us'
 def tearDown(self):
  server.DB=self.old;self.temp.cleanup()
  if self.token is None:os.environ.pop('WA_SYNC_TOKEN',None)
  else:os.environ['WA_SYNC_TOKEN']=self.token
 def user(self,name,dep,companies,triage=False):
  r=self.admin.post('/api/gestao/usuarios',json=dict(nome=name,login=name,senha='TestSenha123',perfil='atendente',departamento_id=dep,empresas=companies,triagem=triage));self.assertEqual(r.status_code,200,r.json)
  client=server.app.test_client();self.assertEqual(client.post('/api/gestao/login',json={'login':name,'senha':'TestSenha123'}).status_code,200);return r.json['id'],client
 def state(self,cid,number):
  r=self.admin.post('/api/gestao/ponte/estado',headers=self.trusted,json=dict(conexao_id=cid,estado='conectado',numero=number));self.assertEqual(r.status_code,200,r.json)
 def incoming(self,mid='one',conn=1,chat=None,**extra):
  m=dict(id=mid,timestamp=time.time()+.01,fromMe=False,body='Pedido do cliente',**extra)
  r=self.admin.post('/api/gestao/ponte/mensagem',headers=self.trusted,json=dict(conexao_id=conn,conversa_id=chat or self.chat,telefone=(chat or self.chat).split('@')[0],nome='Cliente',mensagem=m));self.assertEqual(r.status_code,200,r.json);return r.json['atendimento_id']
 def claim(self):return self.admin.post('/api/gestao/ponte/comandos',headers=self.trusted,json={}).json['comando']
 def test_automatic_assignment_notifications_complete_new_episode(self):
  aid=self.incoming();self.assertIsInstance(aid,int)
  a=self.source.get('/api/gestao/atendimentos/'+str(aid)).json['atendimento'];self.assertEqual(a['usuario_id'],self.source_id);self.assertEqual(a['empresa_id'],1);self.assertEqual(a['numero'],'5567000000001')
  self.assertEqual(len(self.source.get('/api/gestao/avisos').json['mensagens']),1);self.assertEqual(self.other.get('/api/gestao/avisos').json['mensagens'],[])
  self.assertEqual(self.other.get('/api/gestao/atendimentos/'+str(aid)).status_code,403)
  self.assertEqual(self.incoming(),aid);self.assertEqual(self.source.get('/api/gestao/atendimentos/'+str(aid)).json['total_mensagens'],1)
  self.assertEqual(self.source.post(f'/api/gestao/atendimentos/{aid}/situacao',json=dict(status='documentacao',pendencia='Documento de identidade',prazo='2026-10-30')).status_code,200)
  self.assertEqual(self.source.get('/api/gestao/atendimentos?status=ativos').json['total'],1)
  self.assertEqual(self.incoming('two'),aid)
  result=self.source.post(f'/api/gestao/atendimentos/{aid}/encerrar',json={'resumo':'Tudo recebido'});self.assertEqual(result.json['protocolo'],1)
  self.assertEqual(self.incoming('two'),aid) # repeated delivery/ack must not create an episode
  new=self.incoming('three');self.assertNotEqual(aid,new)
  self.assertEqual(self.source.get('/api/gestao/atendimentos/'+str(aid)).json['total_mensagens'],2)
 def test_shared_number_triage_classification_without_duplicate(self):
  self.admin.post('/api/gestao/departamentos/4/conexao',json={'conexao_id':1})
  self.assertIsNone(self.incoming());self.assertIsNone(self.incoming('two'))
  rows=self.source.get('/api/gestao/triagem').json;self.assertEqual(len(rows),1);self.assertEqual(rows[0]['mensagens'],2)
  classified=self.source.post('/api/gestao/triagem/classificar',json=dict(conexao_id=1,conversa_id=self.chat,departamento_id=4,empresa_id=1))
  self.assertEqual(classified.status_code,200,classified.json);aid=classified.json['id']
  self.assertEqual(self.source.get('/api/gestao/atendimentos/'+str(aid)).status_code,403)
  self.assertEqual(self.dest.get('/api/gestao/atendimentos/'+str(aid)).json['total_mensagens'],2)
  self.assertEqual(len(self.dest.get('/api/gestao/avisos').json['mensagens']),2)
  self.assertEqual(self.source.post('/api/gestao/triagem/classificar',json=dict(conexao_id=1,conversa_id=self.chat,departamento_id=4,empresa_id=1)).status_code,409)
 def test_cross_number_transfer_persistent_task_and_correct_send(self):
  cid=self.admin.post('/api/gestao/conexoes',json={'nome':'Fiscal'}).json['id'];self.state(cid,'5567000000002')
  # Created connection is disabled until explicitly connected by the administrator.
  with server.connect() as db:db.execute('UPDATE gestao_conexoes SET habilitada=1 WHERE id=?',(cid,))
  self.admin.post('/api/gestao/departamentos/4/conexao',json={'conexao_id':cid})
  aid=self.incoming();r=self.source.post(f'/api/gestao/atendimentos/{aid}/encaminhar',json=dict(departamento_id=4,usuario_id=self.dest_id,motivo='Apuração fiscal'))
  self.assertEqual(r.status_code,200,r.json);tid=r.json['transferencia_id'];self.assertFalse(r.json['mesmo_numero']);self.assertEqual(r.json['protocolo'],1)
  self.assertEqual(len(self.dest.get('/api/gestao/avisos').json['transferencias']),1)
  self.assertEqual(self.other.get(f'/api/gestao/transferencias/{tid}/contexto').status_code,403)
  self.assertEqual(len(self.dest.get(f'/api/gestao/transferencias/{tid}/contexto').json['mensagens']),1)
  server.init_db();self.assertEqual(len(self.dest.get('/api/gestao/avisos').json['transferencias']),1)
  queued=self.dest.post('/api/gestao/enviar',json=dict(transferencia_id=tid,texto='Olá, setor Fiscal'));self.assertEqual(queued.status_code,202,queued.json)
  command=self.claim();self.assertEqual(command['conexao_id'],cid);self.assertEqual(command['dados']['numero'],'5567000000002')
  self.admin.post(f"/api/gestao/ponte/comandos/{command['id']}/resultado",headers=self.trusted,json=dict(ok=False,resultado={'erro':'Desconectado'}))
  self.assertEqual(len(self.dest.get('/api/gestao/avisos').json['transferencias']),1)
  self.dest.post('/api/gestao/enviar',json=dict(transferencia_id=tid,texto='Olá, setor Fiscal'));command=self.claim()
  r=self.admin.post(f"/api/gestao/ponte/comandos/{command['id']}/resultado",headers=self.trusted,json=dict(ok=True,mensagem={'id':'sent','timestamp':time.time()+1,'fromMe':True,'body':'Olá'},resultado={}))
  self.assertEqual(r.status_code,200,r.json);self.assertEqual(self.dest.get('/api/gestao/avisos').json['transferencias'],[])
  new=self.dest.get('/api/gestao/atendimentos?status=ativos').json['itens'][0];self.assertEqual(new['origem_id'],aid);self.assertEqual(new['conexao_id'],cid)
  self.assertEqual([m['id'] for m in self.dest.get('/api/gestao/atendimentos/'+str(new['id'])).json['mensagens']],['sent'])
  self.assertEqual([m['id'] for m in self.dest.get('/api/gestao/atendimentos/'+str(new['id'])+'/origem').json['mensagens']],['one'])
  self.assertEqual(self.source.get('/api/gestao/atendimentos/'+str(aid)).json['atendimento']['numero'],'5567000000001')
 def test_connections_duplicate_numbers_access_and_unlink(self):
  cid=self.admin.post('/api/gestao/conexoes',json={'nome':'Outra'}).json['id']
  self.assertEqual(self.source.post('/api/gestao/conexoes',json={'nome':'Proibida'}).status_code,403)
  result=self.admin.post('/api/gestao/ponte/estado',headers=self.trusted,json=dict(conexao_id=cid,estado='conectado',numero='5567000000001'));self.assertEqual(result.status_code,409)
  self.assertEqual(self.admin.get('/api/gestao/conexoes').json[-1]['estado'],'divergente')
  aid=self.incoming();self.assertEqual(self.admin.post('/api/gestao/departamentos/6/conexao',json={'conexao_id':cid}).status_code,409)
  self.assertEqual(self.source.post('/api/gestao/ponte/estado',json=dict(conexao_id=1,estado='desconectado')).status_code,403)
  self.assertEqual(self.source.get('/api/whatsapp/historico').status_code,403)
  self.assertEqual(server.app.test_client().get('/api/empresas').status_code,401)
  self.assertEqual([r['id'] for r in self.source.get('/api/empresas').json],[1])
  self.assertEqual(self.source.post('/api/contatos',json={}).status_code,403)
 def test_ambiguous_company_and_unknown_contact_triage(self):
  with server.connect() as db:db.execute("INSERT INTO vinculos VALUES (2,1,'Diretor')")
  self.assertIsNone(self.incoming());self.assertIsNone(self.incoming('unknown',chat='5567992780415@c.us'))
  self.assertEqual(len(self.source.get('/api/gestao/triagem').json),2)
  self.assertEqual(self.other.get('/api/gestao/triagem').status_code,403)
 def test_media_scoped_same_id_different_connection_and_claim_recheck(self):
  aid=self.incoming(hasMedia=True,type='image');cid=self.admin.post('/api/gestao/conexoes',json={'nome':'Fiscal'}).json['id'];self.state(cid,'5567000000002')
  with server.connect() as db:db.execute('UPDATE departamentos SET conexao_id=? WHERE id=4',(cid,))
  other=self.incoming(conn=cid,hasMedia=True,type='image')
  for c,data in [(1,'YWJj'),(cid,'ZGVm')]:self.assertEqual(self.admin.post('/api/gestao/ponte/midia',headers=self.trusted,json=dict(conexao_id=c,mensagem_id='one',midia=dict(data=data,mimetype='image/png'))).status_code,200)
  self.assertEqual(self.source.get(f'/api/gestao/atendimentos/{aid}/arquivo/one').json['data'],'YWJj');self.assertEqual(self.dest.get(f'/api/gestao/atendimentos/{other}/arquivo/one').json['data'],'ZGVm')
  self.assertEqual(self.other.get(f'/api/gestao/atendimentos/{aid}/arquivo/one').status_code,403)
  queued=self.source.post('/api/gestao/enviar',json=dict(atendimento_id=aid,texto='Resposta'));self.assertEqual(queued.status_code,202)
  self.source.post(f'/api/gestao/atendimentos/{aid}/encerrar',json={'resumo':'Encerrado antes do envio'})
  self.assertIsNone(self.claim());self.assertEqual(self.source.get('/api/gestao/comandos/'+str(queued.json['comando_id'])).json['estado'],'erro')
 def test_same_number_transfer_and_one_responsible(self):
  duplicate=self.admin.post('/api/gestao/usuarios',json=dict(nome='Duplicado',login='duplicado',senha='TestSenha123',perfil='atendente',departamento_id=6,empresas=[1]));self.assertEqual(duplicate.status_code,409)
  aid=self.incoming();self.admin.post('/api/gestao/departamentos/4/conexao',json={'conexao_id':1})
  r=self.source.post(f'/api/gestao/atendimentos/{aid}/encaminhar',json=dict(departamento_id=4,usuario_id=self.dest_id,motivo='Fiscal'));self.assertTrue(r.json['mesmo_numero'])
  self.assertEqual(self.dest.get('/api/gestao/avisos').json['transferencias'],[]);self.assertEqual(self.dest.get('/api/gestao/atendimentos/'+str(aid)).json['atendimento']['departamento_entrada'],6)
  self.assertEqual(self.source.get('/api/gestao/atendimentos/'+str(aid)).status_code,403)

 def test_reply_photo_presence_and_delivery_update_do_not_reopen(self):
  photo='data:image/png;base64,YWJj';aid=self.incoming(contactPhoto=photo)
  detail=self.source.get(f'/api/gestao/atendimentos/{aid}').json;self.assertEqual(detail['foto'],photo);self.assertNotIn('contactPhoto',detail['mensagens'][0])
  self.admin.post('/api/gestao/ponte/presenca',headers=self.trusted,json={'conexao_id':1,'valores':{self.chat:{'type':'recording'}}})
  self.assertEqual(self.source.get(f'/api/gestao/atendimentos/{aid}').json['presenca'],'recording')
  self.assertEqual(self.other.get(f'/api/gestao/atendimentos/{aid}').status_code,403)
  self.assertEqual(self.source.post('/api/gestao/enviar',json=dict(atendimento_id=aid,texto='Resposta',resposta_id='outra-conversa')).status_code,400)
  self.source.post('/api/gestao/enviar',json=dict(atendimento_id=aid,texto='Resposta',resposta_id='one'));command=self.claim()
  self.admin.post(f"/api/gestao/ponte/comandos/{command['id']}/resultado",headers=self.trusted,json={'ok':True,'mensagem':{'id':'reply','timestamp':time.time()+.01,'fromMe':True,'body':'Resposta','ack':1},'resultado':{}})
  self.incoming('reply',ack=3) # same message ID must preserve stored quote on update
  rows=self.source.get(f'/api/gestao/atendimentos/{aid}').json['mensagens'];self.assertEqual(next(m for m in rows if m['id']=='reply')['reply']['id'],'one')
  self.source.post(f'/api/gestao/atendimentos/{aid}/lido',json={});self.assertEqual(self.source.get('/api/gestao/avisos').json['mensagens'],[])

 def test_pending_transfer_protects_user_and_interrupted_command_is_not_resent(self):
  cid=self.admin.post('/api/gestao/conexoes',json={'nome':'Fiscal'}).json['id'];self.state(cid,'5567000000002')
  with server.connect() as db:db.execute('UPDATE gestao_conexoes SET habilitada=1 WHERE id=?',(cid,));db.execute('UPDATE departamentos SET conexao_id=? WHERE id=4',(cid,))
  aid=self.incoming();self.source.post(f'/api/gestao/atendimentos/{aid}/encaminhar',json=dict(departamento_id=4,usuario_id=self.dest_id,motivo='Fiscal'))
  changed=self.admin.put('/api/gestao/usuarios/'+str(self.dest_id),json=dict(nome='Fiscal',login='fiscal',perfil='atendente',departamento_id=4,empresas=[1],ativo=False));self.assertEqual(changed.status_code,409)
  tid=self.dest.get('/api/gestao/avisos').json['transferencias'][0]['id'];queued=self.dest.post('/api/gestao/enviar',json=dict(transferencia_id=tid,texto='Olá'));command=self.claim();self.assertIsNotNone(command)
  recovered=self.admin.post('/api/gestao/ponte/comandos',headers=self.trusted,json={'recuperar':True});self.assertIsNone(recovered.json['comando'])
  self.assertEqual(self.dest.get('/api/gestao/comandos/'+str(queued.json['comando_id'])).json['estado'],'erro');self.assertEqual(len(self.dest.get('/api/gestao/avisos').json['transferencias']),1)

if __name__=='__main__':unittest.main()
