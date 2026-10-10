import tempfile, unittest, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server

class PinTests(unittest.TestCase):
 def test_persistence_expiration_and_history_preservation(self):
  old = server.DB
  with tempfile.TemporaryDirectory() as folder:
   try:
    server.DB = Path(folder)/'test.db'; server.init_db(); client = server.app.test_client()
    with server.connect() as db:
     db.execute("INSERT INTO wa_mensagens VALUES ('msg','123@lid',1791522001,'{}')")
    payload = {'mensagem_id':'msg','conversa_id':'123@lid','duracao':3600}
    self.assertEqual(client.post('/api/mensagens/fixadas',json={**payload,'duracao':1}).status_code,400)
    self.assertEqual(client.post('/api/mensagens/fixadas',json={**payload,'conversa_id':'999@lid'}).status_code,409)
    for duration in (3600,604800):
     start=time.time(); response=client.post('/api/mensagens/fixadas',json={**payload,'duracao':duration})
     self.assertEqual(response.status_code,200); self.assertAlmostEqual(response.json['expira']-start,duration,delta=2)
    server.init_db(); self.assertEqual(len(client.get('/api/mensagens/fixadas').json),1)
    with server.connect() as db: db.execute('UPDATE wa_fixadas SET expira=?',(time.time()-1,))
    self.assertEqual(client.get('/api/mensagens/fixadas').json,[])
    client.post('/api/mensagens/fixadas',json=payload)
    self.assertEqual(client.delete('/api/mensagens/fixadas',json=payload).status_code,200)
    self.assertEqual(client.get('/api/mensagens/fixadas').json,[])
    with server.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM wa_mensagens').fetchone()[0],1)
   finally: server.DB=old

if __name__=='__main__': unittest.main()
