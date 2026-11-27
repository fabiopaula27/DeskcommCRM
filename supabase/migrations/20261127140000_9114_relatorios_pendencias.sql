-- 9114 — Relatórios: telefone que falhou ganha nova tentativa; distribuição por fila.

-- Telefones que falharam no envio do período (os outros destinos já receberam).
alter table public.report_schedules
  add column if not exists telefones_pendentes text[] not null default '{}';

-- Reserva da NOVA TENTATIVA só para os telefones pendentes do período já enviado.
-- Esvazia a lista DENTRO da reserva e devolve a lista antiga: uma segunda rodada
-- simultânea encontra a lista vazia e não reenvia. O desfecho devolve à lista só
-- os telefones que falharem de novo. O limite (< 2) é o TENTATIVAS_POR_PERIODO
-- de lib/relatorios/agendamento.ts.
create or replace function public.fn_reservar_reenvio_de_relatorio(p_org uuid, p_chave text)
returns text[]
language sql security invoker set search_path = '' as $$
  with alvo as (
    select organization_id, telefones_pendentes
      from public.report_schedules
     where organization_id = p_org
       and ultimo_periodo = p_chave
       and cardinality(telefones_pendentes) > 0
       and tentativas_do_periodo < 2
     for update
  )
  update public.report_schedules s
     set telefones_pendentes = '{}',
         tentativas_do_periodo = s.tentativas_do_periodo + 1,
         updated_at = now()
    from alvo
   where s.organization_id = alvo.organization_id
  returning alvo.telefones_pendentes;
$$;
revoke all on function public.fn_reservar_reenvio_de_relatorio(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_reservar_reenvio_de_relatorio(uuid, text) to service_role;

-- Distribuições de conversa por atendente, opcionalmente só de uma fila (setor).
-- A fila é a ATUAL da conversa (o evento de atribuição não guarda a fila).
create or replace function public.fn_relatorio_distribuicoes(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_setor uuid default null, p_user uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'total', total) order by total desc), '[]'::jsonb)
  from (
    select e.to_user_id as uid, count(*) as total
    from public.conversation_assignment_events e
    join public.conversations c on c.id = e.conversation_id and c.organization_id = p_org
    where e.organization_id = p_org and e.to_user_id is not null
      and e.created_at >= p_from and e.created_at < p_to
      and (p_setor is null or c.sector_id = p_setor)
      and (p_user is null or e.to_user_id = p_user)
    group by 1
  ) s;
$$;
revoke all on function public.fn_relatorio_distribuicoes(uuid, timestamptz, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.fn_relatorio_distribuicoes(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated, service_role;
