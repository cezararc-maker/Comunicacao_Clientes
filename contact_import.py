"""Non-destructive Google Contacts CSV and vCard import helpers."""
import csv
import io
import re
import quopri
import base64
import unicodedata


def phone_key(value):
    value = str(value or '').strip()
    value = re.sub(r'^tel:', '', value, flags=re.I)
    international = value.startswith(('+', '00'))
    if not re.fullmatch(r'\+?[\d\s().-]+', value):
        raise ValueError('Telefone inválido: informe somente o número, sem ramal.')
    number = re.sub(r'\D', '', value)
    if number.startswith('00'):
        number = number[2:]
    if not 10 <= len(number) <= 15:
        raise ValueError('Telefone deve conter 10 a 15 dígitos.')
    # Domestic Brazilian DDD numbers match WhatsApp's international format.
    return '55' + number if not international and len(number) in (10, 11) else number


def header(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.lower())
                   if not unicodedata.combining(c)).strip()


def parse_csv(blob):
    text = blob.decode('utf-8-sig')
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=',;\t')
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text, newline=''), dialect=dialect)
    fields = reader.fieldnames or []
    phones = [f for f in fields if re.fullmatch(r'(phone|telefone)\s+\d+\s*-\s*(value|valor)', header(f))
              or header(f) in ('phone', 'telefone', 'phone number', 'numero de telefone')]
    if not phones:
        raise ValueError('CSV sem coluna de telefone. Exporte do Google Contacts no formato CSV do Google.')
    records = []
    for row in reader:
        if not any(row.values()):
            continue
        values = {header(k): v or '' for k, v in row.items() if k}
        name = (values.get('name') or values.get('nome') or
                ' '.join(values[k] for k in ('first name', 'middle name', 'last name') if values.get(k)).strip() or
                ' '.join(values[k] for k in ('given name', 'additional name', 'family name') if values.get(k)).strip())
        numbers = [v.strip() for f in phones for v in (row.get(f) or '').split(':::') if v.strip()]
        for number in numbers or ['']:
            records.append({'linha': reader.line_num, 'nome': name, 'telefone': number})
    return records


def unescape(value):
    return re.sub(r'\\([nN,;\\])', lambda m: '\n' if m[1].lower() == 'n' else m[1], value)


def parse_vcard(blob):
    text = blob.decode('utf-8-sig')
    text = re.sub(r'=\r?\n', '', text)  # quoted-printable soft breaks
    text = re.sub(r'\r?\n[ \t]', '', text)  # RFC line unfolding
    records, card, start = [], None, 0
    for line_num, line in enumerate(text.splitlines(), 1):
        if line.upper() == 'BEGIN:VCARD':
            if card is not None:
                raise ValueError('vCard contém cartão não finalizado.')
            card, start = {'phones': [], 'name': '', 'parts': ''}, line_num
        elif line.upper() == 'END:VCARD':
            if card is None:
                raise ValueError('vCard inválido.')
            name = card['name'] or card['parts']
            records.extend({'linha': start, 'nome': name, 'telefone': p}
                           for p in card['phones'] or [''])
            card = None
        elif card is not None and ':' in line:
            meta, value = line.split(':', 1)
            field = meta.split(';')[0].split('.')[-1].upper()
            if field not in ('FN', 'N', 'TEL'):
                continue
            charset = re.search(r'CHARSET=([^;]+)', meta, re.I)
            encoding = re.search(r'ENCODING=([^;]+)', meta, re.I)
            if encoding:
                kind = encoding[1].upper()
                raw = quopri.decodestring(value) if kind == 'QUOTED-PRINTABLE' else (
                    base64.b64decode(value, validate=True) if kind in ('B', 'BASE64') else None)
                if raw is not None:
                    value = raw.decode(charset[1] if charset else 'utf-8')
            if field == 'FN':
                card['name'] = unescape(value).strip()
            elif field == 'N':
                parts = re.split(r'(?<!\\);', value)
                card['parts'] = ' '.join(unescape(parts[i]) for i in (1, 2, 0, 3, 4) if i < len(parts)).strip()
            elif field == 'TEL':
                card['phones'].append(value.strip())
    if card is not None or not records:
        raise ValueError('Arquivo vCard vazio ou incompleto.')
    return records


def inspect_contacts(db, records):
    known = set()
    for row in db.execute('SELECT telefone FROM contatos'):
        try:
            known.add(phone_key(row['telefone']))
        except ValueError:
            continue
    seen, output = set(), []
    for record in records:
        name = str(record.get('nome', '')).strip()
        phone = str(record.get('telefone', '')).strip()
        status, detail = 'novo', 'Novo contato.'
        try:
            phone = phone_key(phone)
            if not name or len(name) > 200:
                raise ValueError('Informe um nome com até 200 caracteres.')
            if phone in known:
                status, detail = 'existente', 'Cadastro, nome e vínculos preservados.'
            elif phone in seen:
                status, detail = 'repetido', 'Telefone já presente neste arquivo.'
            seen.add(phone)
        except ValueError as exc:
            status, detail = 'invalido', str(exc)
        output.append({'linha': record.get('linha', 0), 'nome': name, 'telefone': '+' + phone if status != 'invalido' else phone,
                       'status': status, 'detalhe': detail})
    return output
