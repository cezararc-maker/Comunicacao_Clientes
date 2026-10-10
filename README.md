# Comunicação Clientes v0.5.0 — aplicativo desktop (teste)

## Windows

Instale Python 3.11+ e Node.js LTS. Execute **iniciar_desktop.bat** na raiz do projeto. O aplicativo abre em uma janela Electron (não no navegador).

A primeira execução instala dependências. Clique em **WhatsApp / QR Code** para consultar o estado e escanear o QR com o WhatsApp do celular em **Aparelhos conectados → Conectar aparelho**.

**Esta é uma integração NÃO OFICIAL via whatsapp-web.js**. Pode parar de funcionar ou implicar restrições à conta. Teste exclusivamente com número secundário, nunca com a conta principal do escritório. A sessão fica em dados locais do Electron. Não envie a pasta de sessão ao GitHub nem a compartilhe entre máquinas.

## Recursos neste protótipo
- Cadastros de empresas e contatos, vínculos múltiplos, pesquisa e importação Excel (persistência SQLite).
- Janela desktop Windows via Electron.
- Tela inicial com Enviar documentos, Adicionar contato e Adicionar empresa quando nenhuma conversa está aberta.
- Importação de contatos CSV do Google Contacts (cabeçalhos antigos e atuais) e vCard .vcf, com prévia e confirmação. Cada telefone vira um contato; repetidos são ignorados. Cadastros existentes, nomes e vínculos empresariais são preservados. Não há exclusão nem migração destrutiva do banco.
- Telefones brasileiros informados somente com DDD recebem +55; telefones internacionais devem incluir +DDI ou 00DDI. Novos cadastros usam +DDI; registros anteriores permanecem intactos. Ramais precisam ser removidos do número antes de importar.
- Envio de até 10 documentos por vez, de até 20 MB cada, para conversa ou contato cadastrado, com seleção de arquivos e confirmação do destinatário antes do envio. Em falha parcial, confira os documentos enviados antes de repetir.
- Menu da engrenagem acima das conversas com conexão QR, sincronização, fotos, grupos e acesso aos cadastros/importações.
- QR Code de sessão única via whatsapp-web.js, indicação de estado, listagem inicial de conversas e mensagens novas, envio de texto e resposta citando com duplo clique.

## Não implementado

Servidor multiusuário em LAN, login por funcionário, fila de atendimento, gravação de voz, chamadas, sincronização histórica completa, instalador EXE. **Não use em produção**. A integração QR e o envio real de documentos precisam ser validados em um computador Windows conectado ao WhatsApp.

## Testes em segundo plano

Após instalar requirements.txt, execute `python -m unittest discover -s tests -v` e `node tests/test_documents.cjs`. Os testes usam banco temporário e simulam a conexão WhatsApp; não acessam a sessão real nem os dados de produção.

## Segurança

Flask restringe a interface a `127.0.0.1` neste protótipo. A base contém dados reais se importados; faça backup de `dados/comunicacao.db`. A integração não oficial pode apresentar riscos. Para uso empresarial, avaliar a API oficial.
