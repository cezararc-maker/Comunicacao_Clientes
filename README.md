# Comunicação Clientes v0.8.4 — aplicativo desktop (teste)

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
- Envio de até 10 documentos por vez, de até 20 MB cada: primeiro selecionar arquivos, depois escolher um ou mais contatos/grupos (até 50), por fim confirmar o envio. Em falha parcial, confira os documentos enviados antes de repetir. A seleção expira após 15 minutos.
- Menu da engrenagem acima das conversas com conexão QR, sincronização, fotos, grupos e acesso aos cadastros/importações.
- Nomes das conversas priorizam o nome salvo no WhatsApp do celular; usam o cadastro local e o nome público como alternativas. Identificadores LID são associados ao telefone quando a biblioteca disponibiliza essa informação, sem tratar LID como número de telefone.
- Sincronizar corrige somente cadastros cujo nome ainda é um número. Nomes personalizados, IDs e vínculos existentes permanecem preservados.
- Fotos de perfil originais na lista de conversas, cabeçalho e cadastro de contatos. As imagens dos contatos são carregadas conforme entram na tela; fotos indisponíveis usam iniciais. Atualizar fotos limpa o cache. Acesso depende da disponibilidade e privacidade no WhatsApp.
- Ícones fornecidos pelo usuário adaptados à paleta verde na interface e tela inicial inspirada nos prints de referência.
- Fotos e figurinhas recebidas podem ser carregadas na própria conversa; clique na foto para ampliar. Áudios recebidos, inclusive mensagens de voz, têm controles de reprodução. Os anexos são baixados apenas quando solicitados, com indicação de falha e opção de tentar novamente.
- Envio de fotos com legenda, arquivos de áudio e figurinhas WebP, PNG ou JPG com prévia antes de enviar. Fotos/áudios: até 16 MB; figurinhas selecionadas: até 1 MB. Imagens PNG/JPG são convertidas pela biblioteca para figurinha. Emojis podem ser inseridos pelo seletor ou teclado.
- Gravação pelo microfone, até 2 minutos e 8 MB, com opção de ouvir, descartar ou enviar como mensagem de voz. O microfone só é solicitado ao clicar em Gravar áudio; se o sistema negar acesso, é possível selecionar um arquivo de áudio.
- Esc encerra a visualização da conversa e volta à tela inicial, descartando prévias e gravações ainda não enviadas. Mensagens ficam em ordem cronológica, com as recentes embaixo; a leitura anterior é preservada quando chegam mensagens novas e há um botão para ir às mais recentes. Atualizações de estado não recriam o player de áudio em reprodução.
- QR Code de sessão única via whatsapp-web.js, indicação de estado, listagem inicial de conversas e mensagens novas, envio de texto e resposta citando com duplo clique.

## Escopo temporário de teste

A sincronização consulta diretamente somente **+5567996373431** e **+5567992780415**, conforme `sync_scope.js`, sem listar toda a agenda ou todas as conversas do WhatsApp. A interface de contatos usa esse mesmo filtro durante o teste; cadastros e vínculos dos demais contatos continuam intactos no banco.

São exibidas somente mensagens com timestamp a partir de **09/10/2026 às 01:00 em America/Cuiaba (UTC−04:00; 05:00 UTC)**, incluindo mensagens novas de conversas que já existiam. A consulta é limitada às 100 mensagens mais recentes de cada contato; nenhuma mensagem anterior ao corte entra na conversa exibida. Eventos de outros contatos e grupos são ignorados durante este teste. Não há exclusão de mensagens no WhatsApp, no banco ou em arquivos existentes.

A barra de progresso mede etapas concluídas: consulta dos contatos, identificação dos nomes, atualização dos cadastros, mensagens e fotos. Antes da conexão, os controles de sincronização e fotos ficam desabilitados; a sincronização começa automaticamente após o evento de conexão pronta. Solicitações simultâneas compartilham a mesma execução. Falhas aparecem como pendências, sem confundir 100% das etapas processadas com sucesso de todas as consultas.

Fotos são consultadas pelos identificadores de telefone e LID. O aplicativo tenta carregar os bytes na sessão autenticada e por uma consulta direta alternativa, usando uma imagem incorporada para evitar depender da URL temporária no painel. Resultados sem foto não ficam bloqueados permanentemente no cache. O painel informa fotos carregadas ou indisponíveis.

Na v0.5.3, a consulta usa o objeto interno de conversa como alternativa à serialização incompatível da whatsapp-web.js 1.34.7. O mesmo ajuste permite consultar a conversa quando a biblioteca falha ao resolver a última mensagem. Os identificadores retornados pelo WhatsApp, inclusive números brasileiros sem o nono dígito, são associados ao cadastro solicitado sem alterar telefone, ID ou vínculos no banco. Em diagnóstico na sessão real, as duas fotos de teste foram recuperadas com HTTP 200 e incorporadas como JPEG. A consulta foi feita em segundo plano, sem nova sessão, envio de mensagens ou exclusão de dados.

## Não implementado

Servidor multiusuário em LAN, login por funcionário, fila de atendimento, chamadas, sincronização histórica completa, instalador EXE. **Não use em produção**. A integração QR e o envio real de documentos precisam ser validados em um computador Windows conectado ao WhatsApp.

## Testes em segundo plano

Após instalar requirements.txt, execute `python -m unittest discover -s tests -v`, `node tests/test_contact_names.cjs`, `node tests/test_documents.cjs`, `node tests/test_sync_scope.cjs`, `node tests/test_profile_photos.cjs` e `node tests/test_media.cjs`. Os testes usam banco temporário e simulam a conexão WhatsApp; não acessam a sessão real nem os dados de produção.

## Segurança

Flask restringe a interface a `127.0.0.1` neste protótipo. A base contém dados reais se importados; faça backup de `dados/comunicacao.db`. A integração não oficial pode apresentar riscos. Para uso empresarial, avaliar a API oficial.

Na v0.6.0, os testes de interface em navegador isolado verificaram prévias, envio simulado dos quatro tipos de mídia, emojis, ordem cronológica, player preservado, Esc e gravação com microfone sintético. Nenhuma mensagem foi enviada a contatos reais durante esses testes. O envio e recebimento completos precisam ser conferidos na sessão WhatsApp após atualizar o aplicativo.


Na v0.6.1, conversas e anexos baixados são preservados no banco local `dados/comunicacao.db` e reaparecem ao abrir o aplicativo, antes da conexão WhatsApp. Atualizações não exigem apagar dados ou refazer a sincronização do histórico. A sessão QR continua em `%APPDATA%/comunicacao-clientes/wa-session`. Faça backup dessas duas pastas com o aplicativo fechado; não apague nem substitua o banco para atualizar. O corte de teste continua em 09/10/2026 às 01h (Cuiabá), com somente os dois contatos definidos.

Foram corrigidos os identificadores e o tipo de arquivo usados para baixar mídias nas versões recentes do WhatsApp Web. O compositor possui clipe para fotos, vídeos, áudios e documentos/ZIP, e um adesivo para emojis e figurinhas; gravação permanece à direita. Os vínculos empresariais aparecem na lista de conversas. Mensagens enviadas mostram relógio, visto de envio, entrega e leitura; erros aparecem temporariamente. Fotos são verificadas automaticamente a cada minuto enquanto conectado, respeitando a disponibilidade e privacidade do WhatsApp.


Na v0.7.0, mídias são baixadas automaticamente ao abrir a conversa (duas por vez, cache local e tentativas automáticas limitadas). Imagens coladas com Ctrl+V abrem prévia antes do envio. Fotos e PDFs possuem visualizador que fecha clicando fora. Os áudios recentes observados na sessão de teste tinham confirmação de entrega; agora o player aparece automaticamente.

Os cartões são compactos e arredondados, com empresa/cargo em uma faixa cinza única e contador local de mensagens não lidas. Abrir a conversa limpa o contador. Nos cadastros, o menu ⋮ permite editar contatos/empresas e excluir contatos com confirmação. Excluir contato mantém conversas e mídias; impede que a sincronização automática recrie seu cadastro. Ao criar contato, a caixa opcional solicita sua inclusão na agenda do celular pela API do WhatsApp: requer conexão e suporte da conta; falhas mantêm o cadastro local e são informadas.

Em Configurações → Aparência estão os temas Branco e Azul (padrão), Verde, Violeta, Laranja e Grafite. A preferência é local e muda imediatamente sem descartar formulários. A barra personalizada possui controles fechar/minimizar/maximizar e área de arraste, com cantos internos ajustados ao maximizar. O arredondamento externo e encaixe dependem dos recursos do Windows; não há menu de encaixe nativo ao pairar sobre o controle personalizado. A aparência foi conferida em navegador isolado a 1600×900 e tamanho mínimo. Os comandos de janela foram verificados com chamadas simuladas; arraste/redimensionamento no Windows precisam ser conferidos após iniciar a versão atualizada.


Na v0.8.0, respostas exibem autor e trecho da mensagem original, incluindo respostas a mídias. Clicar no trecho localiza a mensagem se ela estiver armazenada. Trechos são extraídos do conteúdo da própria resposta e do histórico local; não há consulta adicional de mensagens antigas para recuperar citações.

A faixa empresarial mostra a primeira empresa e o número de vínculos adicionais. Após um segundo com o mouse parado, um balão mostra todos os códigos, empresas e cargos/setores. Qualquer movimento esconde o balão e reinicia a espera.

O escopo de teste inclui somente os dois contatos e o grupo chamado exatamente Teste app. A busca do grupo lê os metadados locais, sem buscar mensagens de outros grupos; nomes duplicados impedem selecionar automaticamente. Dados do grupo mostra membros, administradores e descrição. Administradores podem editar a descrição, adicionar telefone com DDI/DDD, promover/rebaixar ou remover outros membros, respeitando as permissões do WhatsApp. Remoção e alterações de administração exigem confirmação no aplicativo. Não são enviados convites privados automaticamente quando a privacidade impede adicionar alguém. Digitar @ apresenta a lista de membros para menção.

A sincronização geral permanece desativada durante os testes. Quando for liberada mediante solicitação, o marco a preservar é 09/10/2026 às 01h de Cuiabá (05h UTC), definido em sync_scope.js. Mensagens anteriores não são armazenadas, e a abertura/reinicialização preserva o banco existente. A sincronização inicial consulta até 100 mensagens recentes por conversa; as novas mensagens recebidas são acrescentadas ao histórico local sem truncá-lo.


Na v0.8.1, as faixas empresariais ajustam sua largura ao texto, com bordas completamente arredondadas e formato Código · Empresa / função. O balão reúne todos os vínculos do telefone do contato, inclusive registros equivalentes existentes, sem limitar a lista à primeira empresa.


Na v0.8.2, clicar no nome do contato ou grupo abre as informações em uma coluna lateral direita, mantendo a conversa visível. O painel mostra telefone e vínculos do contato ou descrição/membros/administração do grupo. O botão Dados do grupo foi retirado; confirmações de alterações de membros permanecem explícitas. Os controles da janela ficam no canto superior direito.

Na v0.8.3, os controles de janela passam a usar círculos de 16 px (antes 13 px), na ordem verde, amarelo e vermelho, da esquerda para a direita.

Na v0.8.4, o duplo clique em toda a linha responde à mensagem. O menu ⋮ de cada mensagem permite fixar por 1 hora ou 7 dias e desafixar. As demandas ficam no topo da conversa e são preservadas no banco local até expirarem; não são fixações compartilhadas no WhatsApp.
