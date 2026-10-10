# Comunicação Clientes v0.2.0 — aplicativo desktop (teste)

## Windows

Instale Python 3.11+ e Node.js LTS. Execute **iniciar_desktop.bat** na raiz do projeto. O aplicativo abre em uma janela Electron (não no navegador).

A primeira execução instala dependências. Clique em **WhatsApp / QR Code** para consultar o estado e escanear o QR com o WhatsApp do celular em **Aparelhos conectados → Conectar aparelho**.

**Esta é uma integração NÃO OFICIAL via whatsapp-web.js**. Pode parar de funcionar ou implicar restrições à conta. Teste exclusivamente com número secundário, nunca com a conta principal do escritório. A sessão fica em dados locais do Electron. Não envie a pasta de sessão ao GitHub nem a compartilhe entre máquinas.

## Recursos neste protótipo
- Cadastros de empresas e contatos, vínculos múltiplos, pesquisa e importação Excel (persistência SQLite).
- Janela desktop Windows via Electron.
- QR Code de sessão única via whatsapp-web.js, indicação de estado, listagem inicial de conversas e mensagens novas, envio de texto e resposta citando com duplo clique.

## Não implementado

Servidor multiusuário em LAN, login por funcionário, fila de atendimento, anexos, gravação de voz, chamadas, sincronização histórica completa, instalador EXE. **Não use em produção**. A integração QR não foi testada em um computador Windows conectado ao WhatsApp.

## Segurança

Flask restringe a interface a `127.0.0.1` neste protótipo. A base contém dados reais se importados; faça backup de `dados/comunicacao.db`. A integração não oficial pode apresentar riscos. Para uso empresarial, avaliar a API oficial.
