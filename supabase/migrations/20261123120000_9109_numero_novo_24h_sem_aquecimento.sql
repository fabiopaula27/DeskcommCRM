-- 9109 · Número novo já nasce respondendo 24h, sem aquecimento e com teto diário alto.
-- manifest: **Padrão SOLUTCRM para número novo.** Gatilho `trg_channel_knobs_padrao_do_numero_novo` (AFTER INSERT em `channel_sessions`) cria a linha de `channel_knobs` com janela de disparo e de resposta 0–24h, domingo liberado, prospecção todos os dias e um único degrau de aquecimento sem teto; `on conflict do nothing` preserva ajuste já feito. Default de `channel_sessions.daily_message_limit` passa a 5000. Números existentes não mudam por esta migration.

create or replace function public.fn_channel_knobs_padrao_do_numero_novo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channel_knobs (
    organization_id, channel_session_id,
    window_start_hour, window_end_hour,
    resposta_start_hour, resposta_end_hour,
    allow_sunday, prospeccao_dias, warmup_daily_caps
  ) values (
    new.organization_id, new.id,
    0, 24,
    0, 24,
    true, '{0,1,2,3,4,5,6}', '[{"minAgeDays":0,"cap":null}]'::jsonb
  )
  on conflict (organization_id, channel_session_id) do nothing;
  return new;
end;
$$;

revoke all on function public.fn_channel_knobs_padrao_do_numero_novo() from public, anon, authenticated;

drop trigger if exists trg_channel_knobs_padrao_do_numero_novo on public.channel_sessions;
create trigger trg_channel_knobs_padrao_do_numero_novo
  after insert on public.channel_sessions
  for each row execute function public.fn_channel_knobs_padrao_do_numero_novo();

alter table public.channel_sessions alter column daily_message_limit set default 5000;
