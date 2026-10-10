import os, tempfile, unittest, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server
class HistoryTests(unittest.TestCase):
 def test_restart_merge_cache_and_registration(self):
  old=server.DB; oldtoken=os.environ.get('WA_SYNC_TOKEN');os.environ['WA_SYNC_TOKEN']='test-history'
  with tempfile.TemporaryDirectory() as folder:
   try:
    server.DB=Path(folder)/'test.db';server.init_db();client=server.app.test_client();headers={'X-Sync-Token':'test-history'}
    with server.connect() as db:
     db.execute("INSERT INTO contatos VALUES (1,'Ana','+5567996373431')");db.execute("INSERT INTO empresas VALUES (1,'001','Empresa','CPF','12345678901')");db.execute("INSERT INTO vinculos VALUES (1,1,'Financeiro')")
    chat={'id':'123@lid','pinnedConversation':True,'markedUnread':True,'phone':'5567996373431','messages':[{'id':'first','timestamp':1791522010,'ack':1,'body':'Preservar'}]}
    self.assertEqual(client.post('/api/whatsapp/historico',json={'conversations':[chat]}).status_code,403)
    self.assertEqual(client.post('/api/whatsapp/historico',headers=headers,json={'conversations':[chat]}).status_code,200)
    chat['messages']=[{'id':'second','timestamp':1791522020,'ack':3}]
    self.assertEqual(client.post('/api/whatsapp/historico',headers=headers,json={'conversations':[chat]}).status_code,200)
    self.assertEqual(client.post('/api/whatsapp/historico',headers=headers,json={'conversations':[chat,None]}).status_code,400)
    group={'id':'12345@g.us','name':'Teste app','isGroup':True,'messages':[{'id':'group-reply','timestamp':1791522030,'reply':{'id':'group-original','body':'Mensagem original','author':'Membro'}}]}
    self.assertEqual(client.post('/api/whatsapp/historico',headers=headers,json={'conversations':[group]}).status_code,200)
    media={'mimetype':'audio/ogg','data':'YWJj','filename':'teste.ogg'}
    self.assertEqual(client.post('/api/whatsapp/midia/first',headers=headers,json=media).status_code,200)
    server.init_db();client=server.app.test_client()
    rows=client.get('/api/whatsapp/historico',headers=headers).json
    private=next(c for c in rows if c['id']=='123@lid');self.assertTrue(private['pinnedConversation']);self.assertTrue(private['markedUnread']);self.assertEqual([m['id'] for m in private['messages']],['first','second'])
    self.assertEqual(next(c for c in rows if c.get('isGroup'))['messages'][0]['reply']['body'],'Mensagem original')
    self.assertEqual(private['messages'][1]['ack'],3)
    self.assertEqual(client.get('/api/whatsapp/midia/first',headers=headers).json,media)
    self.assertEqual(client.post('/api/whatsapp/omitidas',json={'mensagem_id':'first','conversa_id':'123@lid'}).status_code,403)
    self.assertEqual(client.post('/api/whatsapp/omitidas',headers=headers,json={'mensagem_id':'first','conversa_id':'123@lid'}).status_code,200)
    server.init_db();rows=client.get('/api/whatsapp/historico',headers=headers).json
    self.assertEqual([m['id'] for m in next(c for c in rows if c['id']=='123@lid')['messages']],['second'])
    self.assertEqual(client.get('/api/whatsapp/midia/first',headers=headers).json,media)
    with server.connect() as db:
     self.assertEqual(db.execute('SELECT COUNT(*) FROM wa_mensagens WHERE id=\'first\'').fetchone()[0],1)
     self.assertEqual(db.execute('SELECT funcao FROM vinculos').fetchone()[0],'Financeiro')
     self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
   finally:
    server.DB=old
    if oldtoken is None:os.environ.pop('WA_SYNC_TOKEN',None)
    else:os.environ['WA_SYNC_TOKEN']=oldtoken
if __name__=='__main__':unittest.main()
