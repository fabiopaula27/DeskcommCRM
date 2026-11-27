# Anotações do lead — design

## Intenção
Na ficha do contato, o vendedor registra o que sabe do lead (texto ou áudio), vê
tudo em ordem de data/hora, cria tarefas de acompanhamento e pede à IA um resumo
de tudo o que se sabe do lead.

## Decidido pelo usuário
- Aba própria **"Anotações"** na ficha do contato (a aba "Timeline" atual fica como está).
- Texto ou áudio; áudio é transcrito pela IA.
- Cada anotação guarda data e hora do registro.
- Botão para cadastrar tarefa ligada ao lead.
- Botão "Resumo da IA" com todas as informações do lead.

## Abordagens consideradas
1. **Tabela nova `contact_notes` + reaproveitar `crm_tasks` e a transcrição existente (escolhida).**
   Barata, usa o que já existe, cada anotação é registro próprio com autor e hora.
2. Guardar anotações em `custom_fields`/campo "Resumo" do contato. Rejeitada: sem
   histórico, sem autor, sem hora — contraria a linha do tempo.
3. Reaproveitar `conversation_notes` (notas da conversa no Inbox). Rejeitada: é
   ligada à conversa, não ao contato; contato com várias conversas espalharia as notas.

## Como funciona (chamadas minhas, corrigíveis)
- **Áudio — duas origens:** (a) gravar pelo microfone na própria ficha ou enviar um
  arquivo de áudio; (b) botão "Usar áudio da conversa" lista os áudios recentes que o
  lead mandou no WhatsApp e transforma o escolhido em anotação (aproveita a transcrição
  que já existe, ou transcreve na hora). O áudio original fica salvo e tocável.
- **Transcrição:** mesmo provedor/chave usado hoje para áudio do WhatsApp (OpenAI).
  Sem chave configurada: o áudio salva, com aviso "transcrição indisponível".
- **Linha do tempo:** mais recente no topo; cada item mostra data e hora (fuso da
  empresa), autor, tipo (texto/áudio), texto/transcrição e player. Tarefas criadas
  aparecem intercaladas, com status. Autor pode editar/apagar a própria anotação;
  manager+ pode apagar qualquer uma.
- **Nova tarefa:** abre o formulário de tarefa já existente (título, prazo, prioridade,
  responsável), preenchido com o contato/lead.
- **Resumo da IA:** junta dados da ficha, anotações, tarefas, etapa do funil, últimas
  mensagens da conversa e agendamentos; gera texto curto (quem é, o que quer, o que já
  foi combinado, pendências, próximo passo sugerido). Mostra na tela com data de
  geração e botão "Gerar de novo"; opção "Salvar no campo Resumo" da ficha.
- **Acesso:** ver = qualquer membro com acesso ao contato; escrever = agent+.
- **LGPD:** anotações e áudios entram na exclusão/anonimização do contato.

## Não-objetivos
- Não transforma automaticamente todo áudio do lead em anotação.
- Não envia nada ao lead.

## Entregas
Migration (tabela `contact_notes` + bucket de áudio + RLS + cascata LGPD), rotas de
API (listar/criar/editar/apagar, transcrever, resumo), aba "Anotações" na ficha. SQL
rodado pelo usuário no Studio, como de costume.
