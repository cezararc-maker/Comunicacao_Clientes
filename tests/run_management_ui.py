import os,sys,tempfile,json,time,threading,subprocess
from pathlib import Path
repo=Path(__file__).resolve().parents[1];sys.path.insert(0,str(repo))
import app as server
from werkzeug.serving import make_server
os.environ['WA_SYNC_TOKEN']='management-ui-test'
with tempfile.TemporaryDirectory() as folder:
 server.DB=Path(folder)/'ui.db';server.init_db()
 with server.connect() as db:
  db.execute("INSERT INTO empresas VALUES (1,'001','Empresa de Teste','CPF','12345678901')")
  db.execute("INSERT INTO contatos VALUES (1,'Contato de Teste','+5567996373431')")
  db.execute("INSERT INTO vinculos VALUES (1,1,'Financeiro')")
  db.execute('INSERT INTO wa_conversas VALUES (?,?)',('5567996373431@c.us',json.dumps({'id':'5567996373431@c.us','name':'Contato de Teste','phone':'5567996373431'})))
  db.execute('INSERT INTO wa_mensagens VALUES (?,?,?,?)',('previous','5567996373431@c.us',time.time()-100,json.dumps({'id':'previous','body':'Histórico preservado de teste','timestamp':time.time()-100})))
 db=None
 with server.connect() as db:db.execute("UPDATE gestao_conexoes SET numero='5567000000000',estado='conectado' WHERE id=1")
 http=make_server('127.0.0.1',0,server.app);os.environ['MANAGEMENT_UI_TEST_PORT']=str(http.server_port);os.environ['MANAGEMENT_UI_TEST_SERVER']='1';thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
 running=threading.Event();running.set()
 def fake_adapter():
  # Fixture worker confirms synthetic messages; never starts a real WhatsApp client.
  with server.app.test_client() as bridge:
   headers={'X-Sync-Token':'management-ui-test'}
   while running.is_set():
    row=bridge.post('/api/gestao/ponte/comandos',headers=headers,json={}).json.get('comando')
    if row:
     if row['tipo']=='enviar':
      message={'id':'fixture-'+str(row['id']),'body':row['dados']['texto'],'timestamp':time.time()+.01,'fromMe':True,'ack':2}
      bridge.post('/api/gestao/ponte/comandos/'+str(row['id'])+'/resultado',headers=headers,json={'ok':True,'mensagem':message,'resultado':{}})
     else:
      bridge.post('/api/gestao/ponte/estado',headers=headers,json={'conexao_id':row['conexao_id'],'estado':'desconectado' if row['tipo']=='desconectar' else 'qr','qr':'' if row['tipo']=='desconectar' else 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='})
      bridge.post('/api/gestao/ponte/comandos/'+str(row['id'])+'/resultado',headers=headers,json={'ok':True,'resultado':{}})
    running.wait(.01) if not running.is_set() else time.sleep(.08)
 adapter=threading.Thread(target=fake_adapter,daemon=True);adapter.start()
 try:
  result=subprocess.run(['node',str(repo/'tests'/os.environ.get('MANAGEMENT_UI_SCRIPT','test_management_ui.cjs'))],cwd=str(repo));sys.exit(result.returncode)
 finally:running.clear();adapter.join(timeout=2);http.shutdown()
