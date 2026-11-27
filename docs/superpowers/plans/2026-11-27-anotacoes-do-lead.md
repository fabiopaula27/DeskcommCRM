# Anotações do lead — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Anotações" na ficha do contato: anotações por texto/áudio (transcrito), linha do tempo com data/hora, botão de tarefa e "Resumo da IA".

**Architecture:** Tabela nova `contact_notes` + bucket privado `contact-notes`. Rotas em `app/api/v1/contacts/[id]/notes/**`. Transcrição reaproveita a escada (`decidirTranscricao`) extraída do worker para um módulo comum; resumo usa `resolveOrgLlmConfig` + `createDefaultRegistry` + `generateText`. Tarefas reaproveitam `FormularioDeTarefa` e `/api/v1/tasks` (filtro `contact_id`).

**Tech Stack:** Next.js App Router, Supabase (RLS), zod, react-query, vitest, `ai` SDK.

**Spec:** `docs/superpowers/specs/2026-11-27-anotacoes-do-lead-design.md`

## Global Constraints
- Migration `supabase/migrations/20261127160000_9115_anotacoes_do_lead.sql`, idempotente; termina com `notify pgrst, 'reload schema';`. O usuário roda no Studio.
- Leitura: membros da org; escrita: `agent`+; editar/apagar: autor, ou `manager`+ apaga qualquer.
- Datas exibidas no fuso da empresa, formato `dd/MM HH:mm`.
- Texto da anotação: 1..5000 caracteres. Áudio: até 25 MB, mimes `audio/*`.
- Todo texto novo de UI entra em `lib/i18n/dicionario.ts` (teste de i18n exige).
- Sem chave de transcrição: anotação salva com `transcription_status='unavailable'` e aviso "Transcrição indisponível".
- Rotas novas retornam `{disponivel:false}` quando a tabela não existe (42P01/PGRST205), como em Relatórios.

## Review Focus
- Áudio gravado no Safari/iPhone (`audio/mp4`) — deve salvar e transcrever, não só `audio/webm`.
- Falha do provedor de transcrição no meio — anotação fica salva com `failed` e botão "Tentar transcrever de novo".
- Contato sem nenhuma anotação/tarefa/conversa — Resumo da IA não inventa; responde que há pouca informação.
- Usuário de outra organização chamando a rota com id de contato alheio — 404.
- Áudio da conversa que ainda não foi transcrito pelo worker (`media_derived_status` ≠ `ready`) — transcreve na hora.

---

### Task 1: Migration

**Files:** Create `supabase/migrations/20261127160000_9115_anotacoes_do_lead.sql`; append linha em `supabase/migrations/MANIFEST.md`.

- [ ] Tabela `public.contact_notes`: `id uuid pk default gen_random_uuid()`, `organization_id uuid not null → organizations on delete cascade`, `contact_id uuid not null → contacts on delete cascade`, `kind text not null check (kind in ('text','audio'))`, `body text` (texto ou transcrição), `audio_path text`, `audio_duration_s int`, `source_message_id uuid → messages on delete set null`, `transcription_status text check in ('none','pending','ready','failed','unavailable') default 'none'`, `created_by uuid → auth.users on delete set null`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`, check `kind='text' → length(btrim(body))>0`.
- [ ] Índice `(contact_id, created_at desc)`.
- [ ] RLS: select `organization_id in (select fn_user_org_ids())`; insert com `fn_has_role(organization_id,'agent')` e `created_by = auth.uid()`; update/delete se `created_by = auth.uid()` ou `fn_has_role(organization_id,'manager')`. (Conferir nomes exatos das funções na 0210 e copiar o padrão.)
- [ ] Bucket privado `contact-notes` (`insert into storage.buckets ... on conflict do nothing`), path `<org>/<contact>/<uuid>.<ext>`.
- [ ] LGPD: em `fn_lgpd_cascade_redact_contact` NÃO mexer no SQL vigente; a limpeza acontece em TS (Task 6).
- [ ] Commit.

### Task 2: Transcritor da organização (extração)

**Files:** Create `lib/messaging/media/transcritor-da-organizacao.ts` + `.test.ts`; Modify `workers/media-derive-worker.ts` para usar.

**Produces:** `transcritorDaOrganizacao(orgId: string): Promise<{ transcriber: TranscriptionProvider | null; motivo: string }>`

- [ ] Teste: com `decidirTranscricao` mockado devolvendo `transcriber: null`, retorna `{transcriber:null, motivo}`; com binding elevenlabs, passa `elevenlabsEscolhido`.
- [ ] Mover o bloco "DE QUEM É O OUVIDO" do worker (conversa, chaveOpenai, elevenlabsEscolhido) para a função; worker chama a função. Testes atuais do worker devem continuar passando (`pnpm vitest run workers/media-derive-worker`).
- [ ] Commit.

### Task 3: Rotas de anotações

**Files:** Create `app/api/v1/contacts/[id]/notes/route.ts` (GET, POST), `notes/[noteId]/route.ts` (PATCH, DELETE), `notes/[noteId]/transcrever/route.ts` (POST), `notes/audios-da-conversa/route.ts` (GET), `lib/contatos/anotacoes.ts` (lógica pura + tipos) e testes `route.test.ts`.

**Produces:** tipo `Anotacao = { id; kind:'text'|'audio'; body:string|null; audioUrl:string|null; duracao:number|null; status; autor:{id,nome}|null; criadaEm:string; podeEditar:boolean }`.

- [ ] GET: lista anotações do contato (desc) com URL assinada (1h) do áudio e nome do autor (`nomesDosAtendentes`).
- [ ] POST JSON `{kind:'text', body}` → cria. POST multipart `{audio:File, duracao}` → upload no bucket, cria `pending`, transcreve na mesma requisição (`transcritorDaOrganizacao`), atualiza `ready`/`failed`/`unavailable`. POST JSON `{kind:'audio', messageId}` → copia o áudio da mensagem (bucket `whatsapp-media`) e usa `media_derived_text` se `ready`, senão transcreve.
- [ ] Testes: texto vazio → 400; áudio > 25 MB → 413; mime não-áudio → 415; contato de outra org → 404; transcritor nulo → status `unavailable` e 201; erro do transcritor → `failed` e 201; message de outro contato → 404.
- [ ] PATCH (só texto/corpo) e DELETE (apaga arquivo do bucket também) com checagem autor/manager → 403 caso contrário.
- [ ] `transcrever`: refaz a transcrição de anotação `failed`/`unavailable`.
- [ ] `audios-da-conversa`: últimos 20 áudios inbound do contato (`messages.type='audio'`, `direction='inbound'`) com data, duração e trecho do `media_derived_text`.
- [ ] Auditoria: ações `contact_note.created|updated|deleted` em `lib/audit/actions.ts`.
- [ ] Commit.

### Task 4: Resumo da IA

**Files:** Create `lib/contatos/resumo-do-lead.ts` (+ test), `app/api/v1/contacts/[id]/ai-summary/route.ts` (POST).

**Produces:** `montarContextoDoLead(dados): string` (puro) e `gerarResumoDoLead(orgId, contactId): Promise<{texto:string; geradoEm:string}>`.

- [ ] Teste de `montarContextoDoLead`: inclui ficha, anotações com data, tarefas com status/prazo, etapa do funil, últimos agendamentos, últimas 30 mensagens; trunca em 12 000 caracteres priorizando anotações e tarefas.
- [ ] Prompt (pt-BR, fixo): seções "Quem é", "O que quer", "O que já foi combinado", "Pendências", "Próximo passo sugerido"; "Se faltar informação, diga que falta — não invente".
- [ ] Rota: `requireRole("agent")`, chama `gerarResumoDoLead`; sem credencial → 409 `{erro:'ia_nao_configurada'}`. Body opcional `{salvar:true}` grava em `contacts.summary` (conferir nome da coluna "Resumo" em `lib/types/contacts`).
- [ ] Commit.

### Task 5: UI — aba "Anotações"

**Files:** Create `components/contacts/anotacoes/AbaAnotacoes.tsx`, `NovaAnotacao.tsx` (texto + gravar áudio com `MediaRecorder` + enviar arquivo), `AudiosDaConversa.tsx` (diálogo), `LinhaDoTempo.tsx`, `ResumoDaIA.tsx`, `hooks/contacts/useAnotacoes.ts`; Modify `app/app/contacts/[id]/_client.tsx` (novo `TabsTrigger value="notes"` entre timeline e lgpd); test `AbaAnotacoes.test.tsx`.

- [ ] Linha do tempo = anotações + tarefas (`useTasks({contact_id})`) mescladas por data desc; tarefa mostra título, prazo e status.
- [ ] Botão "+ Nova tarefa" abre `FormularioDeTarefa` com `contactId` e `leadId` = lead aberto mais recente do contato (ou null).
- [ ] "Resumo da IA": mostra texto, "Gerado em dd/MM HH:mm", "Gerar de novo", "Salvar no campo Resumo".
- [ ] Gravação: escolher mime suportado (`audio/webm` ou `audio/mp4`), limite 10 min, botão parar/descartar.
- [ ] Testes: lista em ordem; status `unavailable` mostra aviso; botão editar só quando `podeEditar`.
- [ ] Rótulos novos no dicionário i18n.
- [ ] Commit.

### Task 6: LGPD e verificação final

- [ ] Na anonimização/exclusão do contato (`lib/lgpd/cascata.ts`), apagar `contact_notes` do contato e os arquivos do bucket `contact-notes/<org>/<contact>/`.
- [ ] Teste unitário cobrindo a limpeza.
- [ ] `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run components/contacts lib/contatos app/api/v1/contacts lib/messaging/media workers` — tudo verde.
- [ ] Commit; merge `--no-ff` em main; push.
