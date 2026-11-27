-- ============================================================================
-- 9116 — CANAL META SOCIAL (Messenger e Instagram Direct, conexão direta)
--
-- Cada página do Facebook (Messenger) e cada Instagram profissional ligado a
-- ela vira um canal `meta_social`. `meta_social_account_id` é o sessionRef: o
-- id da PÁGINA (Messenger) ou da conta IG (Instagram) — é o `entry.id` que a
-- Meta manda no webhook. O token é o da página (o Instagram usa o da página a
-- que está ligado), cifrado por `fn_encrypt_oauth`.
-- Alargamento puro dos três CHECKs (molde da 9108/0387).
-- ============================================================================

alter table public.channel_sessions
  add column if not exists meta_social_account_id text,
  add column if not exists meta_social_page_id text,
  add column if not exists meta_social_platform text,
  add column if not exists meta_social_token_encrypted bytea;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_meta_social_platform_check;
alter table public.channel_sessions
  add constraint channel_sessions_meta_social_platform_check
    check (meta_social_platform is null or meta_social_platform in ('facebook', 'instagram'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions
  add constraint channel_sessions_provider_check
    check (provider in ('waha', 'meta_cloud', 'zernio', 'zernio_social', 'wacalls', 'datafy', 'evolution', 'meta_social'));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha' and waha_session_name is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls' and wacalls_session_id is not null) or
    (provider = 'datafy' and datafy_phone_number_id is not null) or
    (provider = 'evolution' and evolution_instance_name is not null) or
    (provider = 'meta_social' and meta_social_account_id is not null
       and meta_social_page_id is not null and meta_social_platform is not null)
  );

alter table public.webhook_events_log
  drop constraint if exists webhook_events_log_provider_check;
alter table public.webhook_events_log
  add constraint webhook_events_log_provider_check check (provider in (
    'waha', 'nuvemshop', 'generic', 'meta_cloud', 'zernio', 'datafy', 'stripe', 'asaas', 'evolution', 'meta_social'
  ));

-- A mesma página/IG só pode estar ativa em UMA organização: o webhook acha a
-- organização pela conta, e duas linhas tornariam o dono da mensagem ambíguo.
create unique index if not exists channel_sessions_meta_social_account_ativo_unique
  on public.channel_sessions (meta_social_account_id)
  where meta_social_account_id is not null and archived_at is null;

comment on column public.channel_sessions.meta_social_account_id is
  'Id da página (Messenger) ou da conta IG (Instagram) na Meta — sessionRef do canal meta_social (lib/channels/session-ref.ts).';

notify pgrst, 'reload schema';
