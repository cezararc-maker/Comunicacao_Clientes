# Atendimento por empresa, departamento e número — v0.18.0

Esta versão substitui o registro manual separado pelo fluxo integrado de atendimento. A base continua local para testes; não é uma implantação de servidor compartilhado entre computadores.

## Configuração inicial

1. Atualize, abra o aplicativo e entre em **Gestão** como administrador. Os usuários já criados permanecem cadastrados.
2. Em **Departamentos → Configurar número**, escolha uma conexão existente, conecte um novo número por QR Code ou desvincule apenas o departamento.
3. Em **Conexões**, confira o número real, o estado e os departamentos vinculados. Cada conexão utiliza uma sessão independente. A conexão 1 conserva o diretório de sessão anterior.
4. No cadastro de **Usuários**, atribua o departamento e as empresas sob responsabilidade. Há um responsável ativo por empresa em cada departamento. Para trocar, retire a responsabilidade anterior antes de atribuir a nova. Atendimentos já abertos mantêm o responsável até serem transferidos.
5. Marque a permissão de triagem para os usuários que poderão classificar mensagens. Em números compartilhados, esse usuário pode escolher qualquer departamento que utilize a mesma conexão, sem ganhar acesso geral aos respectivos históricos.

Desconectar um número interrompe todos os departamentos que o compartilham. Desvincular um departamento mantém a sessão dos demais. A desconexão conserva os arquivos de autenticação e permite reconectar. Um número já cadastrado em outra conexão não é aceito como segunda sessão: utilize o vínculo compartilhado. Números históricos não são reassociados automaticamente a outra conta.

## Conversa e estados

Mensagens novas recebidas abrem automaticamente um atendimento quando há um único departamento, uma empresa identificada e um responsável ativo. Em caso de ambiguidade, número compartilhado, contato desconhecido ou ausência de responsável, entram em **Triagem**. Classificar incorpora as mensagens aguardando ao mesmo atendimento e notifica o responsável.

**Iniciar conversa** envia a primeira mensagem pelo número do departamento selecionado. A abertura só é confirmada após a resposta do adaptador do WhatsApp. Uma indisponibilidade preserva o texto na tela. Não existe envio por um número alternativo. O mesmo contato pode ter atendimentos em conexões diferentes sem mistura de mensagens ou arquivos.

O painel mostra o número, departamento, empresa e responsável. Permite responder, anexar arquivos, gravar áudio, colar imagens, arrastar arquivos e selecionar figurinhas/GIFs. A mídia recebida carrega automaticamente; PDFs podem ser ampliados. Duplo clique em uma mensagem prepara a resposta. Os vistos acompanham o retorno do WhatsApp. Indicadores de digitação/gravação dependem do suporte da versão conectada do WhatsApp Web. **Esc** fecha a conversa e retorna à lista.

- **Em atendimento:** demanda ativa.
- **Com pendência:** registra a ação faltante e prazo opcional.
- **Aguardando documentação:** registra os documentos solicitados e prazo opcional.
- **Concluído:** exige resumo, gera o protocolo único e encerra internamente. Uma mensagem nova abre outro atendimento; o anterior permanece no histórico.

Notificações são dirigidas ao usuário atribuído ao atendimento. Supervisores consultam a gestão sem receber os alertas dos demais responsáveis. Clicar em uma notificação abre a conversa e procura a mensagem correspondente na página carregada. Os avisos de mensagem são marcados como lidos ao abrir o atendimento. O histórico anterior continua disponível ao administrador.

## Transferências

**Mesmo número:** mantém o atendimento e a conexão, registra origem, destino e motivo, e altera o responsável. Compartilhar o número não compartilha automaticamente o acesso às mensagens.

**Outro número:** encerra a origem com protocolo e motivo de transferência. Cria uma pendência persistente para o destinatário, com acesso ao contexto original. O cartão não tem opção de dispensar. Abrir a notificação, consultar o contexto ou falhar no envio não resolve a pendência. Ela é resolvida quando o atendimento no destino começa após confirmação da primeira mensagem, ou quando uma mensagem recebida abre esse atendimento identificado. A continuação recebe seu próprio registro ligado à origem; as mensagens anteriores não são apresentadas como recebidas no novo número.

Não altere o número do departamento enquanto houver atendimentos ativos ou transferências aguardando início. Usuários com transferências pendentes não podem ser desativados nem perder os vínculos necessários. Uma operação interrompida durante o envio não é reenviada automaticamente: confira a conversa antes de tentar outra vez.

## Dados e limites de testes

A migração cria um backup consistente em `dados/backups` antes da primeira instalação deste fluxo, acrescenta tabelas e mantém cadastros, vínculos, mensagens anteriores e sessões. Não importa conversas antigas para criar atendimentos retroativos. O registro automático começa na instalação deste fluxo; o histórico do desenvolvimento anterior permanece preservado.

Continua válido o escopo autorizado: contatos **+5567996373431** e **+5567992780415**, além do grupo **Teste app** na área anterior do administrador. Não foram liberadas sincronizações gerais. As sessões adicionais recebem eventos novos dos dois contatos; não fazem busca de mensagens antigas.

O administrador mantém a área anterior com os recursos já existentes. Atendentes utilizam o painel integrado da Gestão; operações administrativas e envios na área anterior exigem administrador também no serviço e no processo Electron. A implementação usa o serviço local e não muda automaticamente uma instalação de outro computador para um banco compartilhado. A implantação central para vários computadores continua sendo uma etapa separada.

## Validação

- `python -m unittest discover -s tests -p "test_*.py"`
- `node tests/test_department_connections.cjs`
- `python tests/run_management_ui.py`

Os testes usam bancos temporários, clientes simulados e navegador oculto, sem alterar o WhatsApp real. Cobrem dois números, número compartilhado, triagem, responsáveis, permissões, mídia por conexão, histórico, sequência de protocolos, transferências, pendência após falha/reinício e número remetente. Conexões simultâneas com números reais, envio de voz/mídia e disponibilidade dos QR Codes ainda precisam de validação no aplicativo com as contas de teste.
