ATUALIZAÇÃO DO PROTOCOLO — NÚMEROS POR DEPARTAMENTO

O aplicativo “Comunicação Clientes” deve suportar vários números telefônicos conectados simultaneamente. Cada departamento terá um número associado, mas dois ou mais departamentos poderão compartilhar uma mesma conexão.

1. CADASTRO DAS CONEXÕES

Criar uma área administrativa “Conexões”, permitindo:
- Adicionar e conectar números diferentes.
- Identificar cada conexão por nome e número.
- Consultar a situação: conectado, desconectado ou aguardando conexão.
- Reconectar e desativar uma conexão.
- Visualizar os departamentos vinculados.

Cada número deve possuir uma única conexão cadastrada, que poderá ser utilizada por vários departamentos. Não criar sessões duplicadas para representar departamentos que compartilham o mesmo número.

Identificar a tecnologia de integração existente e verificar seu suporte a múltiplas conexões. Não simular conexões que a integração não consiga manter.

2. VÍNCULO ENTRE DEPARTAMENTOS E NÚMEROS

Departamentos:
Recepção, Rural, Pessoal, Fiscal, Contábil, Financeiro e Empresarial.

Na configuração de cada departamento, permitir:
- Vincular uma conexão já cadastrada.
- Cadastrar uma nova conexão.
- Consultar quais outros departamentos utilizam o mesmo número.

Exemplo:
- Pessoal → número A.
- Fiscal → número B.
- Contábil → número B.

Nesse exemplo, Fiscal e Contábil compartilham a conexão B.

A opção “Compartilhar número com outro departamento” deve vincular ambos à mesma conexão. O compartilhamento do número não concede automaticamente acesso aos atendimentos do outro departamento.

3. USUÁRIOS E RESPONSABILIDADES

Cada usuário permanece vinculado ao seu departamento e às empresas sob sua responsabilidade.

A definição de responsáveis por empresa deve considerar o departamento. Uma empresa pode ter um responsável no Pessoal e outro no Fiscal.

As notificações devem considerar conjuntamente:
- Número que recebeu a mensagem.
- Departamento relacionado ao atendimento.
- Empresa vinculada ao atendimento.
- Usuários responsáveis e autorizados.

4. ENCAMINHAMENTO DAS MENSAGENS

Número exclusivo de um departamento:
- Encaminhar a mensagem para esse departamento.
- Identificar a empresa e notificar seus responsáveis.
- Quando houver dúvida sobre a empresa ou ausência de responsável, encaminhar para a fila de triagem daquele departamento.

Número compartilhado:
- Manter uma fila de entrada compartilhada para mensagens sem departamento definido.
- Permitir que um usuário autorizado identifique o departamento e a empresa.
- Após a classificação, aplicar as responsabilidades e notificações correspondentes.
- Não enviar a mesma mensagem como dois atendimentos independentes apenas porque existem dois departamentos vinculados ao número.

Permitir configurar quais usuários podem acessar e classificar a fila compartilhada.

5. IDENTIFICAÇÃO DOS ATENDIMENTOS

Acrescentar aos registros:
- Identificador da conexão.
- Número pelo qual o atendimento foi recebido ou iniciado.
- Departamento de entrada.
- Departamento responsável atual.
- Histórico de transferências.

Identificar visivelmente o departamento e o número utilizado no cabeçalho da conversa.

Separar os registros pelo conjunto conexão + contato + atendimento. O mesmo contato pode conversar com números diferentes, sem misturar históricos ou enviar respostas pela conexão errada.

Preservar o número e o departamento registrados no atendimento mesmo que os vínculos sejam alterados posteriormente.

6. ENVIO E NOVAS CONVERSAS

Ao iniciar uma conversa pelo botão “+”:
- Utilizar o número vinculado ao departamento do usuário.
- Se o usuário tiver autorização para atuar em mais de um departamento, permitir escolher o departamento antes do envio.
- Mostrar claramente o número remetente.
- Pesquisar contatos e empresas conforme as regras já previstas.
- Verificar se existe atendimento ativo para a mesma conexão, contato e empresa antes de criar outro.

Se a conexão estiver indisponível, informar o problema e preservar a mensagem digitada. Não enviar automaticamente por outro número.

7. TRANSFERÊNCIAS

Entre departamentos que compartilham o mesmo número:
- Transferir a responsabilidade interna.
- Preservar a conversa, a conexão e as mensagens.
- Registrar origem, destino, usuário, horário e motivo.

Entre departamentos com números diferentes:
- Não tratar como simples troca interna de responsável.
- Oferecer encaminhamento interno do contexto e abertura de um atendimento relacionado na conexão de destino.
- Manter o atendimento original vinculado ao número original.
- Não apresentar mensagens antigas como se tivessem sido recebidas pelo novo número.
- Explicar ao atendente que as próximas mensagens enviadas pelo departamento de destino utilizarão outro número.

8. HISTÓRICO, PROTOCOLOS E ACESSO

Manter o protocolo sequencial único para todo o aplicativo, gerado no encerramento.

Acrescentar ao histórico filtros por:
- Conexão.
- Número telefônico.
- Departamento de entrada e departamento responsável.

Preservar os filtros de usuário, empresa, contato, período e protocolo.

Aplicar as permissões no serviço de dados e na interface. Compartilhar uma conexão não significa compartilhar irrestritamente o histórico entre departamentos.

9. VALIDAÇÃO

Testar:
- Vários números conectados simultaneamente.
- Dois departamentos compartilhando um número.
- O mesmo contato conversando com números diferentes.
- Resposta enviada pela conexão correta.
- Notificações restritas aos responsáveis.
- Classificação na fila compartilhada.
- Transferências com número compartilhado e com números diferentes.
- Desconexão de um número sem interromper os demais.
- Alteração de vínculos sem modificar os registros históricos.

Essa estrutura substitui a premissa anterior de todos os departamentos utilizarem um único número.