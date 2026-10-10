import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as server
from contact_import import parse_csv, parse_vcard, phone_key


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = server.DB
        server.DB = Path(self.temp.name) / 'test.db'
        server.init_db()
        self.client = server.app.test_client()
        with server.connect() as db:
            db.execute("INSERT INTO contatos VALUES (1,'Nome preservado','67999999999')")
            db.execute("INSERT INTO empresas VALUES (1,'001','Empresa preservada','CPF','12345678901')")
            db.execute("INSERT INTO vinculos VALUES (1,1,'Responsável')")

    def tearDown(self):
        server.DB = self.old_db
        self.temp.cleanup()

    def preview(self, text, filename='contacts.csv'):
        return self.client.post('/api/contatos/importar/previa', data={
            'arquivo': (io.BytesIO(text.encode('utf-8-sig')), filename)})

    def test_csv_dedup_and_preservation(self):
        text = 'Name,Phone 1 - Value,Phone 2 - Value\nOutro nome,+55 (67) 99999-9999,\n"Maria, Silva",+5567988888888,+5567988888888\n'
        preview = self.preview(text)
        self.assertEqual(preview.status_code, 200)
        rows = preview.json['linhas']
        self.assertEqual([r['status'] for r in rows], ['existente', 'novo', 'repetido'])
        result = self.client.post('/api/contatos/importar/confirmar', json={'linhas': rows})
        self.assertEqual(result.json, {'ok': True, 'novos': 1, 'preservados': 2})
        again = self.client.post('/api/contatos/importar/confirmar', json={'linhas': rows})
        self.assertEqual(again.json['novos'], 0)
        contacts = self.client.get('/api/contatos').json
        old = next(c for c in contacts if c['id'] == 1)
        self.assertEqual(old['nome'], 'Nome preservado')
        self.assertEqual(old['telefone'], '67999999999')
        self.assertEqual(old['empresas'][0]['funcao'], 'Responsável')
        self.assertEqual(len(contacts), 2)

    def test_invalid_is_atomic_and_revalidates_preview(self):
        rows = [{'nome': 'Valido', 'telefone': '5567988888888', 'status': 'novo'},
                {'nome': '', 'telefone': '123', 'status': 'novo'}]
        result = self.client.post('/api/contatos/importar/confirmar', json={'linhas': rows})
        self.assertEqual(result.status_code, 409)
        self.assertEqual(len(self.client.get('/api/contatos').json), 1)
        rows = rows[:1]
        self.client.post('/api/contatos', json=rows[0])
        result = self.client.post('/api/contatos/importar/confirmar', json={'linhas': rows})
        self.assertEqual(result.json['novos'], 0)

    def test_vcard_folding_escaping_qp_and_multiple_phones(self):
        text = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana\\,\r\n  Souza\r\nTEL;TYPE=CELL:tel:+5567988888888\r\nTEL:+5567977777777\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Jos=E9\r\nTEL:5567966666666\r\nEND:VCARD'
        result = self.preview(text, 'contacts.vcf')
        self.assertEqual(result.status_code, 200)
        self.assertEqual([r['nome'] for r in result.json['linhas']], ['Ana, Souza', 'Ana, Souza', 'José'])
        self.assertEqual(self.client.post('/api/contatos/importar/confirmar', json=result.json).json['novos'], 3)

    def test_csv_new_google_headers_and_semicolon(self):
        rows = parse_csv(b'First Name;Last Name;Phone 1 - Value\nAna;Souza;67988888888 ::: +5567977777777\n')
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['nome'], 'Ana Souza')
        self.assertEqual(phone_key(rows[0]['telefone']), '5567988888888')

    def test_invalid_files_and_payloads(self):
        for text, name in [('Name,Email\nAna,a@b.com', 'x.csv'),
                           ('BEGIN:VCARD\nFN:Ana', 'x.vcf'), ('', 'x.csv')]:
            self.assertEqual(self.preview(text, name).status_code, 400)
        for body in ({'linhas': [None]}, {'linhas': []}, [], None):
            self.assertEqual(self.client.post('/api/contatos/importar/confirmar', json=body).status_code, 400)
        for value in ('123', '+5567988888888 ramal 12', '5567988888888;ext=12'):
            with self.assertRaises(ValueError):
                phone_key(value)

    def test_international_country_code_survives_confirmation(self):
        preview = self.preview('Name,Phone 1 - Value\nInternational,+1 202 555 0123\n')
        self.assertEqual(preview.json['linhas'][0]['telefone'], '+12025550123')
        result = self.client.post('/api/contatos/importar/confirmar', json=preview.json)
        self.assertEqual(result.json['novos'], 1)
        stored = next(c for c in self.client.get('/api/contatos').json if c['nome'] == 'International')
        self.assertEqual(stored['telefone'], '+12025550123')
        self.assertEqual(self.preview('Name,Phone 1 - Value\nOther name,+12025550123\n').json['linhas'][0]['status'], 'existente')

    def test_manual_and_sync_use_same_phone_identity(self):
        response = self.client.post('/api/contatos', json={'nome': 'Duplicado', 'telefone': '+5567999999999'})
        self.assertEqual(response.status_code, 409)
        os.environ['WA_SYNC_TOKEN'] = 'test-only-token'
        result = self.client.post('/api/whatsapp/sync', headers={'X-Sync-Token': 'test-only-token'}, json={
            'contatos': [{'nome': 'Outro', 'telefone': '5567999999999'},
                         {'nome': 'Novo', 'telefone': '5567988888888'}]})
        self.assertEqual(result.json['novos'], 1)
        self.assertEqual(result.json['existentes'], 1)
        self.assertEqual(len(self.client.get('/api/contatos').json), 2)

    def test_search_by_name_and_company(self):
        self.client.post('/api/contatos', json={'nome': 'Maria', 'telefone': '5567988888888'})
        self.assertEqual([c['nome'] for c in self.client.get('/api/pesquisa?q=Maria').json], ['Maria'])
        result = self.client.get('/api/pesquisa?q=Empresa').json
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['empresas'][0]['nome'], 'Empresa preservada')

    def test_sync_repairs_only_numeric_names_without_changing_links(self):
        with server.connect() as db:
            db.execute("UPDATE contatos SET nome='67999999999' WHERE id=1")
        os.environ['WA_SYNC_TOKEN'] = 'test-only-token'
        response = self.client.post('/api/whatsapp/sync', headers={'X-Sync-Token': 'test-only-token'}, json={
            'contatos': [{'nome': 'Nome salvo no celular', 'telefone': '5567999999999'}]})
        self.assertEqual(response.json['nomes_atualizados'], 1)
        contact = self.client.get('/api/contatos').json[0]
        self.assertEqual(contact['nome'], 'Nome salvo no celular')
        self.assertEqual(contact['id'], 1)
        self.assertEqual(contact['telefone'], '67999999999')
        self.assertEqual(contact['empresas'][0]['funcao'], 'Responsável')
        again = self.client.post('/api/whatsapp/sync', headers={'X-Sync-Token': 'test-only-token'}, json={
            'contatos': [{'nome': 'Nome público diferente', 'telefone': '5567999999999'}]})
        self.assertEqual(again.json['nomes_atualizados'], 0)
        self.assertEqual(self.client.get('/api/contatos').json[0]['nome'], 'Nome salvo no celular')

    def test_filtered_contacts_preserve_existing_data(self):
        self.client.post('/api/contatos', json={'nome': 'Teste', 'telefone': '+5567996373431'})
        rows = self.client.get('/api/contatos?telefones=5567996373431').json
        self.assertEqual([r['nome'] for r in rows], ['Teste'])
        self.assertEqual(len(self.client.get('/api/contatos').json), 2)
        legacy = self.client.get('/api/contatos?telefones=5567999999999').json
        self.assertEqual(legacy[0]['empresas'][0]['funcao'], 'Responsável')
        self.assertEqual(self.client.get('/api/contatos?telefones=123').status_code, 400)


if __name__ == '__main__':
    unittest.main()
