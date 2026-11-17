-- 9108 · Canal de WhatsApp Evolution API (QR/Baileys, servidor da instalação).
-- manifest: **Canal Evolution API (WhatsApp por QR/Baileys).** Coluna `channel_sessions.evolution_instance_name` (sessionRef) com indice unico parcial; indice unico parcial `(organization_id, metadata->>'evolution_idempotency_key')` para a idempotencia da conexao; recria `channel_sessions_provider_check`, `channel_sessions_provider_ref_check` e `webhook_events_log_provider_check` (preservando stripe/asaas da 0601) com `evolution`. Alargamento puro, sem backfill. Par no `baseline.sql`.
--
-- Provider novo `evolution`, ao lado de `waha`, `meta_cloud`, `zernio` e
-- `datafy`. A referência é o nome da instância no servidor Evolution
-- (`evolution_instance_name`), em coluna PRÓPRIA, e é o `sessionRef` do canal.
-- Espelhado em lib/channels/session-ref.ts.
--
-- Recria os três CHECKs inteiros (drop+add, padrão da 0131/0387): o vocabulário
-- é o da 0387 mais `evolution`; o ref_check ganha o ramo da coluna nova; e
-- `webhook_events_log_provider_check` ganha `evolution` porque a rota genérica
-- arquiva o corpo cru com o provider da sessão antes de conferir a assinatura.
-- Alargamento puro nos três: nenhuma linha existente é violada, sem backfill.
--
-- Índice único parcial, como a 0165/0387: o nome da instância é identificador
-- do provider e não pode repetir entre organizações. A coluna nasce vazia em
-- toda instalação, então não há dedup a fazer.

alter table public.channel_sessions
  add column if not exists evolution_instance_name text;

comment on column public.channel_sessions.evolution_instance_name is
  'Nome da instância no servidor Evolution API. É o sessionRef deste canal. Espelhado em lib/channels/session-ref.ts.';

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
    check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls', 'datafy', 'evolution'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha' and waha_session_name is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls' and wacalls_session_id is not null) or
    (provider = 'datafy' and datafy_phone_number_id is not null) or
    (provider = 'evolution' and evolution_instance_name is not null)
  );

alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;

alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check check (provider in (
    'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy', 'stripe', 'asaas', 'evolution'
  ));

create unique index if not exists channel_sessions_evolution_instance_name_unique
  on public.channel_sessions (evolution_instance_name)
  where evolution_instance_name is not null;

-- Idempotência do POST de conexão: a mesma chave por organização = uma linha só.
create unique index if not exists channel_sessions_evolution_idempotency_unique
  on public.channel_sessions (organization_id, (metadata->>'evolution_idempotency_key'))
  where metadata->>'evolution_idempotency_key' is not null;

notify pgrst, 'reload schema';
