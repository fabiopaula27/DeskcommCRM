# Messenger e Instagram Direct direto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar páginas do Facebook e Instagram profissionais pelo login da Meta, receber Messenger/Direct no Inbox e responder pela Send API.

**Architecture:** Provider novo `meta_social` em `channel_sessions` (molde do `datafy`, migration 0387): colunas `meta_social_account_id` (id da página ou da conta IG — o `sessionRef`), `meta_social_page_id`, `meta_social_platform` (`facebook`|`instagram`), `meta_social_token_encrypted` (`fn_encrypt_oauth`). Login: OAuth da Meta (Facebook Login for Business, `config_id`) → callback troca código → lista páginas + IG → pessoa escolhe → canais criados e página inscrita em `subscribed_apps`. Webhook: rota pública `app/api/v1/webhooks/meta-social/route.ts`, assinatura `X-Hub-Signature-256` com o App Secret de `appDaMeta()`, normaliza para `ZernioInboundMessage` e chama `ingestZernioInbound` (contato/conversa/IA/automação reaproveitados). Envio: `metaSocialAdapter` (`ChannelAdapter`) via Graph `/{page-id}/messages` (Messenger) e `/{ig-id}/messages` (IG) com o token da página.

**Tech Stack:** Next.js App Router, Supabase, zod, Graph API v21.0, vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-messenger-instagram-direto-design.md`

## Global Constraints
- Graph API base `https://graph.facebook.com/v21.0` (constante única `GRAPH_SOCIAL`).
- Permissões do login: `pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement,instagram_basic,instagram_manage_messages,business_management`.
- Campos inscritos: Messenger `messages,messaging_postbacks,message_echoes`; IG via a mesma página.
- Config do app: `META_APP_ID` e `META_LOGIN_CONFIG_ID` (env; banco opcional fica fora), App Secret e verify token vêm de `appDaMeta()`.
- Conectar/desconectar: `requireRole("admin")` (owner/admin).
- Migration `20261127180000_9116_canal_meta_social.sql`, idempotente, recria os CHECKs de provider por alargamento (como a 0387), `notify pgrst`.
- Toda consulta em `channel_sessions` filtra `organization_id` (invariante `canal-consulta-por-organizacao`).
- Webhook nunca devolve 500 para a Meta por evento desconhecido: 200 + ignora; assinatura inválida → 401.
- Textos novos de UI no `lib/i18n/dicionario.ts` com espanhol.

## Review Focus
- Evento de eco (`is_echo`) e mensagens enviadas pela própria página/IG → não viram mensagem do lead nem pausam a IA indevidamente (marcar como outbound externo, como o ingest já trata `direction: "outbound"`).
- Mesma página conectada em duas organizações → índice único parcial impede; segunda conexão recebe erro claro.
- Token da página revogado/expirado (erro Graph 190) no envio ou na saúde → canal FAILED com motivo "reconectar".
- Envio fora da janela de 24h (erro Graph 10 / subcode 2018278 / IG 2534022) → falha com mensagem clara em pt-BR.
- Anexo recebido (imagem/áudio do lead) → URL da Meta expira; baixar e guardar no `whatsapp-media` como o ingest faz com anexos.

---

### Task 1: Migration + vocabulário do provider

**Files:** Create migration 9116; Modify `lib/channels/types.ts` (`ChannelProvider` += `"meta_social"`), `capabilities.ts` (bloco `meta_social`: texto, imagem, áudio, arquivo; sem template, sem grupo, sem reação), `session-ref.ts` (coluna `meta_social_account_id`), `presentation.ts` ("Messenger"/"Instagram" pelo metadata), `index.ts` (adapter registrado na Task 4 — até lá stub `isConfigured: false`).
- [ ] Migration: colunas acima, CHECKs `channel_sessions_provider_check`, `_provider_ref_check` e `webhook_events_log_provider_check` recriados com `meta_social`; índice único parcial `(meta_social_account_id) where archived_at is null and provider='meta_social'`.
- [ ] `pnpm tsc --noEmit` limpo; rodar `tests/unit/canal-consulta-por-organizacao.test.ts` e testes de `lib/channels/capabilities*` → passam.
- [ ] Commit.

### Task 2: Cliente Graph + parser do webhook (puros)

**Files:** Create `lib/channels/meta-social/graph.ts`, `parser.ts`, `parser.test.ts`, `assinatura.ts`, `assinatura.test.ts`.

**Produces:**
- `assinaturaValida(corpoBruto: string, cabecalho: string | null, appSecret: string): boolean` (HMAC-SHA256, `timingSafeEqual`).
- `parsearEventos(payload: unknown): EventoSocial[]` onde `EventoSocial = { plataforma: "facebook"|"instagram"; contaId: string /* page id ou ig id = entry.id */; remetenteId: string; destinatarioId: string; mid: string; texto: string|null; anexos: {type:string;url:string}[]; eco: boolean; em: string; referral: unknown|null }`.
- `paraMensagemDoIngest(e: EventoSocial): ZernioInboundMessage` (`direction` = eco ? "outbound":"inbound", `conversationId` = id do lead (PSID/IGSID), `externalId` = mid, `accountId` = contaId, `identity` com o id do lead).
- `graphSocial(token, caminho, init?)` com erro tipado `ErroGraph {code, subcode, message}`.
- [ ] Testes do parser com payloads reais (Messenger texto, Messenger imagem, IG texto, eco, `read`/`delivery` ignorados, `object` desconhecido → []).
- [ ] Testes da assinatura: válida, inválida, cabeçalho ausente.
- [ ] Commit.

### Task 3: Webhook

**Files:** Create `app/api/v1/webhooks/meta-social/route.ts` + `route.test.ts`; Modify `lib/auth/public-paths.ts` (rota pública).
- [ ] GET: `hub.mode=subscribe` + `hub.verify_token` == verify token do `appDaMeta()` → devolve `hub.challenge`; senão 403.
- [ ] POST: assinatura → 401 se inválida; para cada evento acha a sessão ativa `provider='meta_social' and meta_social_account_id = contaId` (admin client, resultado define a org); sem sessão → ignora; chama `ingestZernioInbound(db, {organizationId, channelSessionId, payload, socialMessage})`; sempre 200.
- [ ] Testes: challenge certo/errado, assinatura inválida 401, evento de conta desconhecida 200 sem ingest, evento válido chama ingest com a org da sessão.
- [ ] Commit.

### Task 4: Adaptador de envio + saúde

**Files:** Create `lib/channels/adapters/meta-social.ts` + test; `lib/channels/meta-social/credenciais.ts` (lê/decifra token por sessão, filtrando org).
- [ ] `send`: texto `{recipient:{id}, message:{text}, messaging_type:"RESPONSE"}`; mídia por `attachment{type,payload:{url,is_reusable:false}}` (URL assinada do storage). Destinatário = `providerConversationId` (id do lead).
- [ ] Erros: 190 → código `token_invalido`; janela 24h → `fora_da_janela` com texto "A Meta só permite responder até 24h depois da última mensagem do lead."
- [ ] `checkHealth`: GET `/{conta}?fields=id` com o token → WORKING / FAILED(`reconectar`).
- [ ] Testes com `fetch` mockado: texto ok, imagem ok, 190, janela.
- [ ] Commit.

### Task 5: Login da Meta e escolha de páginas

**Files:** Create `app/api/v1/channels/meta-social/login/route.ts` (GET → redireciona ao diálogo OAuth com `state` assinado: org+user+nonce, cookie httpOnly), `callback/route.ts` (troca código → token de usuário longo → `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}` → guarda lista em cache temporário cifrado por 10 min → redireciona à tela de escolha), `paginas/route.ts` (GET lista pendente; POST `{contas:[{id, plataforma}]}` cria/reativa sessões, cifra token da página, chama `POST /{page-id}/subscribed_apps`), `[sessionId]/route.ts` DELETE (desinscreve se nenhuma outra sessão usa a página, arquiva); `lib/channels/meta-social/oauth.ts` (+ test do `state`).
- [ ] Testes: `state` adulterado → recusado; conta já ativa em outra org → 409 `conta_em_outra_empresa`; escolha cria sessão Messenger e IG da mesma página com o MESMO token.
- [ ] Commit.

### Task 6: Tela em Conexões › Redes sociais + guia

**Files:** Create `components/connections/MetaSocialConexoes.tsx` (+ test), `docs/guias/messenger-instagram.md`; Modify `components/connections/RedesSociaisClient.tsx` (mostra o bloco direto acima; o da Zernio só se configurada), dicionário i18n.
- [ ] Bloco: botão "Conectar com Facebook" (sem `META_APP_ID`/`META_LOGIN_CONFIG_ID` → aviso "Falta configurar o app da Meta"), lista de canais com ícone, nome, status e "Desconectar"; tela de escolha das páginas com caixas de seleção.
- [ ] Guia passo a passo: app (caso de uso Messenger + Instagram), Login do Facebook for Business (config, permissões, URL de callback `https://<domínio>/api/v1/channels/meta-social/callback`), webhook (`/api/v1/webhooks/meta-social`, campos), env no Easypanel, conectar, testar, App Review (texto do pedido e roteiro do vídeo).
- [ ] Testes do componente: sem config mostra aviso; lista canais; desconectar chama DELETE.
- [ ] `tsc`, lint, testes de `lib/channels components/connections app/api/v1/webhooks/meta-social app/api/v1/channels/meta-social` verdes.
- [ ] Commit; review final; merge `--no-ff` em main; push.
