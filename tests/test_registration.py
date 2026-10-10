import os, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app as server
class RegistrationTests(unittest.TestCase):
 def test_edit_conflict_delete_and_history_preservation(self):
  previous=server.DB
  with tempfile.TemporaryDirectory() as folder:
   try:
    server.DB=Path(folder)/'test.db';server.init_db();client=server.app.test_client()
    with server.connect() as db:
     db.execute("INSERT INTO contatos VALUES (1,'Ana','+5567996373431')");db.execute("INSERT INTO contatos VALUES (2,'Outro','+5567992780415')")
     db.execute("INSERT INTO empresas VALUES (1,'001','Empresa','CPF','12345678901')");db.execute("INSERT INTO vinculos VALUES (1,1,'Financeiro')")
     db.execute("INSERT INTO wa_mensagens VALUES ('msg','123@lid',1791522010,'{}')")
    self.assertEqual(client.put('/api/contatos/1',json={'nome':'Ana editada','telefone':'+5567996373431'}).status_code,200)
    self.assertEqual(client.put('/api/contatos/1',json={'nome':'Duplicado','telefone':'+5567992780415'}).status_code,409)
    self.assertEqual(client.put('/api/empresas/1',json={'codigo':'002','nome':'Empresa corrigida','tipo':'CPF','documento':'12345678901'}).status_code,200)
    contact=client.get('/api/contatos').json[0];self.assertEqual(contact['empresas'][0]['funcao'],'Financeiro');self.assertEqual(contact['empresas'][0]['codigo'],'002')
    self.assertEqual(client.delete('/api/contatos/1').status_code,200)
    with server.connect() as db:
     self.assertEqual(db.execute('SELECT COUNT(*) FROM wa_mensagens').fetchone()[0],1)
     self.assertEqual(db.execute('SELECT COUNT(*) FROM empresas').fetchone()[0],1)
     self.assertEqual(db.execute('SELECT COUNT(*) FROM vinculos').fetchone()[0],0)
     self.assertEqual(db.execute('SELECT telefone FROM contatos_excluidos').fetchone()[0],'5567996373431')
   finally:server.DB=previous
if __name__=='__main__':unittest.main()
