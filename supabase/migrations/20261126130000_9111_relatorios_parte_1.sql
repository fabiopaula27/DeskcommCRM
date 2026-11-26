-- 9111 — Relatórios (parte 1): agregadores de Atendimento, Leads & Vendas e Funil.
-- Somas no banco; a rota só monta a resposta. SECURITY INVOKER: a RLS do chamador vale.
-- Critérios iguais aos de Métricas: venda = crm_leads.status 'won' com closed_at na janela;
-- receita = soma de value_cents; mensagem de IA = sent_via 'ai'; humana = 'user','crm','external_device'.

create or replace function public.fn_relatorio_atendimento(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_user uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with
  dias as (
    select (now() at time zone p_tz)::date as hoje
  ),
  limites as (
    select
      (d.hoje::timestamp at time zone p_tz) as ini_hoje,
      ((d.hoje + 1)::timestamp at time zone p_tz) as fim_hoje,
      ((d.hoje - 1)::timestamp at time zone p_tz) as ini_ontem,
      ((d.hoje - 29)::timestamp at time zone p_tz) as ini_30
    from dias d
  ),
  cards as (
    select
      jsonb_build_object(
        'conversas', (select count(*) from public.conversations c where c.organization_id = p_org and c.created_at >= l.ini_hoje and c.created_at < l.fim_hoje),
        'leads', (select count(*) from public.crm_leads x where x.organization_id = p_org and x.created_at >= l.ini_hoje and x.created_at < l.fim_hoje),
        'vendas', (select count(*) from public.crm_leads x where x.organization_id = p_org and x.status = 'won' and x.closed_at >= l.ini_hoje and x.closed_at < l.fim_hoje),
        'receita_cents', (select coalesce(sum(x.value_cents), 0) from public.crm_leads x where x.organization_id = p_org and x.status = 'won' and x.closed_at >= l.ini_hoje and x.closed_at < l.fim_hoje)
      ) as hoje,
      jsonb_build_object(
        'conversas', (select count(*) from public.conversations c where c.organization_id = p_org and c.created_at >= l.ini_ontem and c.created_at < l.ini_hoje),
        'leads', (select count(*) from public.crm_leads x where x.organization_id = p_org and x.created_at >= l.ini_ontem and x.created_at < l.ini_hoje),
        'vendas', (select count(*) from public.crm_leads x where x.organization_id = p_org and x.status = 'won' and x.closed_at >= l.ini_ontem and x.closed_at < l.ini_hoje),
        'receita_cents', (select coalesce(sum(x.value_cents), 0) from public.crm_leads x where x.organization_id = p_org and x.status = 'won' and x.closed_at >= l.ini_ontem and x.closed_at < l.ini_hoje)
      ) as ontem,
      jsonb_build_object(
        'conversas', (select count(*) from public.conversations c where c.organization_id = p_org and c.created_at >= l.ini_30),
        'leads', (select count(*) from public.crm_leads x where x.organization_id = p_org and x.created_at >= l.ini_30),
        'vendas', (select count(*) from public.crm_leads x where x.organization_id = p_org and x.status = 'won' and x.closed_at >= l.ini_30),
        'receita_cents', (select coalesce(sum(x.value_cents), 0) from public.crm_leads x where x.organization_id = p_org and x.status = 'won' and x.closed_at >= l.ini_30)
      ) as trinta
    from limites l
  ),
  convs as (
    select c.*
    from public.conversations c
    where c.organization_id = p_org
      and c.created_at >= p_from and c.created_at < p_to
      and (p_user is null or c.assigned_to_user_id = p_user)
  ),
  msgs as (
    select m.*
    from public.messages m
    where m.organization_id = p_org
      and m.created_at >= p_from and m.created_at < p_to
      and (
        p_user is null
        or m.sent_by_user_id = p_user
        or (m.direction = 'inbound' and m.conversation_id in (
          select c2.id from public.conversations c2
          where c2.organization_id = p_org and c2.assigned_to_user_id = p_user
        ))
      )
  ),
  primeira as (
    select
      m.conversation_id,
      min(m.created_at) filter (where m.direction = 'inbound') as primeira_in,
      min(m.created_at) filter (where m.direction = 'outbound' and m.sent_via in ('user', 'crm', 'external_device')) as primeira_humana
    from msgs m
    group by m.conversation_id
  )
select jsonb_build_object(
  'hoje', (select hoje from cards),
  'ontem', (select ontem from cards),
  'trinta_dias', (select trinta from cards),
  'conversas_por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'total', total) order by dia)
    from (select (created_at at time zone p_tz)::date as dia, count(*) as total from convs group by 1) s
  ), '[]'::jsonb),
  'conversas_resumo', jsonb_build_object(
    'total', (select count(*) from convs),
    'ativas', (select count(*) from convs where status in ('open', 'pending', 'claimed', 'ai_handling') and (bot_silenced_until is null or bot_silenced_until <= now())),
    'pausadas', (select count(*) from convs where bot_silenced_until > now()),
    'tempo_medio_atendimento_s', (
      select round(avg(extract(epoch from (service_closed_at - service_started_at))))
      from convs where service_started_at is not null and service_closed_at > service_started_at
    ),
    'tempo_primeira_resposta_s', (
      select round(percentile_cont(0.5) within group (order by extract(epoch from (primeira_humana - primeira_in))))
      from primeira where primeira_in is not null and primeira_humana > primeira_in
    )
  ),
  'por_canal', coalesce((
    select jsonb_agg(jsonb_build_object('canal', canal, 'total', total) order by total desc)
    from (select coalesce(channel, 'outro') as canal, count(*) as total from convs group by 1) s
  ), '[]'::jsonb),
  'mensagens', jsonb_build_object(
    'enviadas', (select count(*) from msgs where direction = 'outbound'),
    'humanas', (select count(*) from msgs where direction = 'outbound' and sent_via in ('user', 'crm', 'external_device')),
    'ia', (select count(*) from msgs where direction = 'outbound' and sent_via = 'ai'),
    'recebidas', (select count(*) from msgs where direction = 'inbound'),
    'conversas_com_mensagem', (select count(distinct conversation_id) from msgs)
  ),
  'humanas_por_hora', coalesce((
    select jsonb_agg(jsonb_build_object('hora', hora, 'total', total) order by hora)
    from (select extract(hour from created_at at time zone p_tz)::int as hora, count(*) as total
          from msgs where direction = 'outbound' and sent_via in ('user', 'crm', 'external_device') group by 1) s
  ), '[]'::jsonb),
  'ia_por_hora', coalesce((
    select jsonb_agg(jsonb_build_object('hora', hora, 'total', total) order by hora)
    from (select extract(hour from created_at at time zone p_tz)::int as hora, count(*) as total
          from msgs where direction = 'outbound' and sent_via = 'ai' group by 1) s
  ), '[]'::jsonb),
  'ia_por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'total', total) order by dia)
    from (select (created_at at time zone p_tz)::date as dia, count(*) as total
          from msgs where direction = 'outbound' and sent_via = 'ai' group by 1) s
  ), '[]'::jsonb),
  'atendentes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id,
      'conversas', coalesce(c.total, 0),
      'mensagens', coalesce(m.total, 0),
      'leads', coalesce(ld.total, 0),
      'vendas', coalesce(v.total, 0)
    ) order by coalesce(c.total, 0) desc)
    from (
      select assigned_to_user_id as user_id from convs where assigned_to_user_id is not null
      union select sent_by_user_id from msgs where direction = 'outbound' and sent_by_user_id is not null
      union select owner_user_id from public.crm_leads
            where organization_id = p_org and owner_user_id is not null
              and ((created_at >= p_from and created_at < p_to) or (status = 'won' and closed_at >= p_from and closed_at < p_to))
    ) u
    left join (select assigned_to_user_id as uid, count(*) as total from convs group by 1) c on c.uid = u.user_id
    left join (select sent_by_user_id as uid, count(*) as total from msgs where direction = 'outbound' group by 1) m on m.uid = u.user_id
    left join (select owner_user_id as uid, count(*) as total from public.crm_leads
               where organization_id = p_org and created_at >= p_from and created_at < p_to group by 1) ld on ld.uid = u.user_id
    left join (select owner_user_id as uid, count(*) as total from public.crm_leads
               where organization_id = p_org and status = 'won' and closed_at >= p_from and closed_at < p_to group by 1) v on v.uid = u.user_id
    where (p_user is null or u.user_id = p_user)
  ), '[]'::jsonb),
  'distribuicoes', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', uid, 'total', total) order by total desc)
    from (select e.to_user_id as uid, count(*) as total
          from public.conversation_assignment_events e
          where e.organization_id = p_org and e.to_user_id is not null
            and (p_user is null or e.to_user_id = p_user)
            and e.created_at >= p_from and e.created_at < p_to
          group by 1) s
  ), '[]'::jsonb)
);
$$;

create or replace function public.fn_relatorio_leads(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_owner uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with
  criados as (
    select * from public.crm_leads
    where organization_id = p_org and created_at >= p_from and created_at < p_to
      and (p_owner is null or owner_user_id = p_owner)
  ),
  ganhos as (
    select * from public.crm_leads
    where organization_id = p_org and status = 'won' and closed_at >= p_from and closed_at < p_to
      and (p_owner is null or owner_user_id = p_owner)
  )
select jsonb_build_object(
  'leads_total', (select count(*) from criados),
  'convertidos', (select count(*) from criados where status = 'won'),
  'leads_por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'total', total) order by dia)
    from (select (created_at at time zone p_tz)::date as dia, count(*) as total from criados group by 1) s
  ), '[]'::jsonb),
  'origens', coalesce((
    select jsonb_agg(jsonb_build_object('origem', origem, 'total', total) order by total desc)
    from (select coalesce(nullif(btrim(source), ''), 'sem origem') as origem, count(*) as total from criados group by 1) s
  ), '[]'::jsonb),
  'vendas_total', (select count(*) from ganhos),
  'receita_cents', (select coalesce(sum(value_cents), 0) from ganhos),
  'vendas_por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'total', total, 'receita_cents', receita) order by dia)
    from (select (closed_at at time zone p_tz)::date as dia, count(*) as total, coalesce(sum(value_cents), 0) as receita
          from ganhos group by 1) s
  ), '[]'::jsonb),
  'vendedores', coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id,
      'leads', coalesce(c.total, 0),
      'vendas', coalesce(g.total, 0),
      'receita_cents', coalesce(g.receita, 0)
    ) order by coalesce(g.receita, 0) desc, coalesce(c.total, 0) desc)
    from (
      select owner_user_id as user_id from criados where owner_user_id is not null
      union select owner_user_id from ganhos where owner_user_id is not null
    ) u
    left join (select owner_user_id as uid, count(*) as total from criados group by 1) c on c.uid = u.user_id
    left join (select owner_user_id as uid, count(*) as total, coalesce(sum(value_cents), 0) as receita from ganhos group by 1) g on g.uid = u.user_id
    where (p_owner is null or u.user_id = p_owner)
  ), '[]'::jsonb)
);
$$;

create or replace function public.fn_relatorio_funil(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_pipeline uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with leads as (
  select * from public.crm_leads
  where organization_id = p_org and created_at >= p_from and created_at < p_to
    and (p_pipeline is null or pipeline_id = p_pipeline)
)
select jsonb_build_object(
  'funis', coalesce((
    select jsonb_agg(jsonb_build_object(
      'pipeline_id', p.id, 'nome', p.name, 'posicao', p.position,
      'leads', coalesce(l.total, 0), 'valor_cents', coalesce(l.valor, 0)
    ) order by p.position, p.name)
    from public.crm_pipelines p
    left join (select pipeline_id, count(*) as total, coalesce(sum(value_cents), 0) as valor
               from leads group by 1) l on l.pipeline_id = p.id
    where p.organization_id = p_org and p.is_archived = false
      and (p_pipeline is null or p.id = p_pipeline)
  ), '[]'::jsonb),
  'etapas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'pipeline_id', s.pipeline_id, 'stage_id', s.id, 'nome', s.name,
      'posicao', s.position, 'leads', coalesce(l.total, 0)
    ) order by s.pipeline_id, s.position)
    from public.crm_stages s
    left join (select stage_id, count(*) as total from leads group by 1) l on l.stage_id = s.id
    where s.organization_id = p_org and s.is_archived = false
      and (p_pipeline is null or s.pipeline_id = p_pipeline)
  ), '[]'::jsonb)
);
$$;

revoke all on function public.fn_relatorio_atendimento(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.fn_relatorio_leads(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.fn_relatorio_funil(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fn_relatorio_atendimento(uuid, timestamptz, timestamptz, text, uuid) to authenticated, service_role;
grant execute on function public.fn_relatorio_leads(uuid, timestamptz, timestamptz, text, uuid) to authenticated, service_role;
grant execute on function public.fn_relatorio_funil(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
