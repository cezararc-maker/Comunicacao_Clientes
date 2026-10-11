> Roteiro da v0.17.0 preservado como referência. Para a versão atual, use [Atendimento por departamentos](ATENDIMENTO_DEPARTAMENTOS.md).

# Gestão e histórico — primeira etapa de testes (0.17.0)

## Começar

Após atualizar e reiniciar, entre em **Gestão** na barra lateral. No primeiro acesso, crie o administrador com nome, login e senha de pelo menos oito caracteres. Nenhuma senha padrão é criada.

O administrador cadastra os usuários, escolhe o departamento e marca as empresas sob responsabilidade. Os sete departamentos do protocolo já aparecem: Recepção, Rural, Pessoal, Fiscal, Contábil, Financeiro e Empresarial. Os cadastros podem ser editados pelos três pontos. Usuários e departamentos são desativados, sem apagar registros históricos.

## Atendimento de teste

1. Com o WhatsApp conectado, escolha **Atendimentos → Registrar atendimento**.
2. Selecione uma conversa já salva, o departamento, a empresa (ou triagem sem empresa) e o assunto.
3. As novas mensagens já recebidas pelo aplicativo passam a compor esse registro; nenhuma busca de mensagens antigas é iniciada.
4. Use **Transferir atendimento** para trocar o departamento e responsável na mesma conexão, informando o motivo.
5. Use **Encerrar atendimento**, registre a solução e receba o protocolo sequencial único. Repetir o encerramento mantém o mesmo protocolo.
6. Consulte **Histórico** pelos filtros de empresa, usuário, período, contato, protocolo, conexão, número e departamento de entrada/responsável.

Para impedir duplicação de mensagens entre departamentos, esta etapa aceita apenas um atendimento aberto por conversa e conexão. A triagem sem empresa exige a permissão correspondente. Uma transferência exige um destinatário ativo e responsável pela empresa no departamento de destino.

## Preservação

A primeira atualização de uma base existente cria uma cópia SQLite consistente em `dados/backups/antes_gestao_*.db` antes de acrescentar as tabelas. Não remove ou recria as tabelas existentes. A sessão WhatsApp e os arquivos de mídia continuam no mesmo lugar.

As conversas anteriores ficam em **Histórico anterior**, restrito ao administrador. Não recebem usuário, empresa ou departamento retroativamente. Atendimentos novos começam no horário em que são registrados. Mensagens anteriores continuam acessíveis na conversa e na consulta anterior.

O número e o departamento de entrada ficam registrados no atendimento. Empresa, código, responsável e nomes dos departamentos são fotografados como texto nos registros: alterações cadastrais posteriores não reescrevem o histórico. As movimentações e mensagens encerradas são preservadas. As mídias são lidas do cache local quando disponíveis; a consulta não força uma nova sincronização.

## Limites desta etapa

- A integração WhatsApp ainda utiliza uma única sessão real. Os departamentos compartilham essa conexão; não são simulados números adicionais.
- O login e as permissões são aplicados no serviço e na interface da **Gestão**, incluindo seus históricos e mídias. As áreas atuais de conversa, envio, cadastro de contatos/empresas e notificações continuam com o comportamento anterior. Portanto, esta etapa é para testes, não para implantação com isolamento completo entre atendentes.
- A próxima etapa integra a identidade do usuário ao envio, recebimento, filas e notificações WhatsApp; depois inclui conexões simultâneas e transferências entre números distintos.
- Uma mudança do número autenticado não reassocia automaticamente os atendimentos antigos. A gestão sinaliza divergência e bloqueia novos registros até a definição correta da conexão.
- Sessões de gestão duram oito horas. Uma alteração no usuário invalida suas sessões. Não é permitido remover o último administrador nem desativar/trocar de departamento usuários com atendimentos abertos sem realocação.
- Esta é uma instalação local. Os testes não criam rede de estações nem servidor multiusuário remoto.

## Validação em base temporária

`python -m unittest discover -s tests -p "test_*.py"`

`python tests/run_management_ui.py`

O segundo comando utiliza um servidor em porta aleatória, banco temporário e navegador oculto. Não acessa a sessão real, não usa o banco em `dados` e não envia mensagens. Os testes verificam migração, nomes históricos, permissão por departamento e empresa, transferências, encerramento idempotente, sequência de protocolos, login, preservação das conversas e telas da gestão.
