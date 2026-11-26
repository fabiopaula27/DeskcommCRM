-- 9112 — Relatórios (parte 2): Metas & Produtos e Templates Oficiais.
-- SECURITY INVOKER (RLS do chamador), search_path vazio, só `authenticated`.
-- Metas: `crm_metas` só tem o indicador `vendas_ganhas` (quantidade por mês, da empresa
-- ou por funil); o realizado é o mesmo de Métricas (status 'won', closed_at na janela).
-- Produtos: itens de propostas ACEITAS (`crm_proposals.status = 'aceita'`, decided_at na janela).
-- Templates: mensagens `type = 'template'` enviadas; respondida = entrada na mesma conversa em até 24 h.

create or replace function public.fn_relatorio_metas(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_owner uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with
  meses as (
    select m.periodo, m.pipeline_id, m.alvo
    from public.crm_metas m
    where m.organization_id = p_org and m.indicador = 'vendas_ganhas'
      and m.periodo >= date_trunc('month', (p_from at time zone p_tz))::date
      and m.periodo < (p_to at time zone p_tz)::date
  ),
  ganhos as (
    select * from public.crm_leads
    where organization_id = p_org and status = 'won' and closed_at >= p_from and closed_at < p_to
      and (p_owner is null or owner_user_id = p_owner)
  )
select jsonb_build_object(
  'metas_total', (select count(*) from meses),
  'alvo_empresa', (select coalesce(sum(alvo), 0) from meses where pipeline_id is null),
  'alvo_por_funis', (select coalesce(sum(alvo), 0) from meses where pipeline_id is not null),
  'realizado', (select count(*) from ganhos),
  'receita_cents', (select coalesce(sum(value_cents), 0) from ganhos),
  'meses', coalesce((
    select jsonb_agg(jsonb_build_object('periodo', periodo, 'alvo', alvo) order by periodo)
    from meses where pipeline_id is null
  ), '[]'::jsonb),
  'realizado_por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'total', total) order by dia)
    from (select (closed_at at time zone p_tz)::date as dia, count(*) as total from ganhos group by 1) s
  ), '[]'::jsonb),
  'por_funil', coalesce((
    select jsonb_agg(jsonb_build_object(
      'pipeline_id', p.id, 'nome', p.name,
      'alvo', coalesce(mm.alvo, 0), 'realizado', coalesce(g.total, 0)
    ) order by p.position, p.name)
    from public.crm_pipelines p
    left join (select pipeline_id, sum(alvo) as alvo from meses where pipeline_id is not null group by 1) mm on mm.pipeline_id = p.id
    left join (select pipeline_id, count(*) as total from ganhos group by 1) g on g.pipeline_id = p.id
    where p.organization_id = p_org and p.is_archived = false
      and (mm.alvo is not null or g.total is not null)
  ), '[]'::jsonb),
  'por_vendedor', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', uid, 'vendas', total, 'receita_cents', receita) order by total desc)
    from (select owner_user_id as uid, count(*) as total, coalesce(sum(value_cents), 0) as receita
          from ganhos where owner_user_id is not null group by 1) s
  ), '[]'::jsonb)
);
$$;

create or replace function public.fn_relatorio_produtos(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_owner uuid default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with itens as (
  select
    i.product_id,
    coalesce(cp.nome, i.descricao) as nome,
    i.quantidade,
    (i.quantidade * i.preco_unitario_cents - i.desconto_cents) as receita_cents,
    i.desconto_cents,
    p.decided_at,
    l.owner_user_id
  from public.crm_proposal_items i
  join public.crm_proposals p on p.id = i.proposal_id
  left join public.crm_leads l on l.id = p.lead_id
  left join public.catalog_products cp on cp.id = i.product_id
  where i.organization_id = p_org and p.organization_id = p_org
    and p.status = 'aceita'
    and p.decided_at >= p_from and p.decided_at < p_to
    and (p_owner is null or l.owner_user_id = p_owner)
)
select jsonb_build_object(
  'produtos_distintos', (select count(distinct coalesce(product_id::text, nome)) from itens),
  'itens_vendidos', (select coalesce(sum(quantidade), 0) from itens),
  'receita_cents', (select coalesce(sum(receita_cents), 0) from itens),
  'descontos_cents', (select coalesce(sum(desconto_cents), 0) from itens),
  'por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'total', total, 'receita_cents', receita) order by dia)
    from (select (decided_at at time zone p_tz)::date as dia, sum(quantidade) as total, sum(receita_cents) as receita
          from itens group by 1) s
  ), '[]'::jsonb),
  'por_hora', coalesce((
    select jsonb_agg(jsonb_build_object('hora', hora, 'total', total) order by hora)
    from (select extract(hour from decided_at at time zone p_tz)::int as hora, sum(quantidade) as total
          from itens group by 1) s
  ), '[]'::jsonb),
  'top_produtos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nome', nome, 'quantidade', qtd, 'receita_cents', receita, 'descontos_cents', descontos
    ) order by receita desc)
    from (select nome, sum(quantidade) as qtd, sum(receita_cents) as receita, sum(desconto_cents) as descontos
          from itens group by nome order by sum(receita_cents) desc limit 20) s
  ), '[]'::jsonb),
  'por_vendedor', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', uid, 'itens', qtd, 'receita_cents', receita) order by receita desc)
    from (select owner_user_id as uid, sum(quantidade) as qtd, sum(receita_cents) as receita
          from itens where owner_user_id is not null group by 1) s
  ), '[]'::jsonb)
);
$$;

create or replace function public.fn_relatorio_templates(
  p_org uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_template text default null
) returns jsonb
language sql stable security invoker set search_path = '' as $$
with
  enviados as (
    select m.id, m.conversation_id, m.created_at, m.template_name
    from public.messages m
    where m.organization_id = p_org and m.direction = 'outbound' and m.type = 'template'
      and m.created_at >= p_from and m.created_at < p_to
      and m.template_name is not null
      and (p_template is null or m.template_name = p_template)
  ),
  marcados as (
    select e.*,
      exists (
        select 1 from public.messages r
        where r.organization_id = p_org and r.conversation_id = e.conversation_id
          and r.direction = 'inbound'
          and r.created_at > e.created_at and r.created_at <= e.created_at + interval '24 hours'
      ) as respondido
    from enviados e
  ),
  categoria as (
    select distinct on (t.name) t.name, upper(t.category) as category
    from public.meta_templates t
    where t.organization_id = p_org
    order by t.name, t.synced_at desc nulls last
  )
select jsonb_build_object(
  'enviados', (select count(*) from marcados),
  'respondidos', (select count(*) from marcados where respondido),
  'por_dia', coalesce((
    select jsonb_agg(jsonb_build_object('dia', dia, 'enviados', env, 'respondidos', resp) order by dia)
    from (select (created_at at time zone p_tz)::date as dia, count(*) as env, count(*) filter (where respondido) as resp
          from marcados group by 1) s
  ), '[]'::jsonb),
  'por_template', coalesce((
    select jsonb_agg(jsonb_build_object(
      'nome', s.template_name, 'categoria', c.category, 'enviados', s.env, 'respondidos', s.resp
    ) order by s.env desc)
    from (select template_name, count(*) as env, count(*) filter (where respondido) as resp
          from marcados group by 1) s
    left join categoria c on c.name = s.template_name
  ), '[]'::jsonb),
  'nomes', coalesce((
    select jsonb_agg(name order by name) from (select distinct name from public.meta_templates where organization_id = p_org) n
  ), '[]'::jsonb)
);
$$;

revoke all on function public.fn_relatorio_metas(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.fn_relatorio_produtos(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
revoke all on function public.fn_relatorio_templates(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.fn_relatorio_metas(uuid, timestamptz, timestamptz, text, uuid) to authenticated, service_role;
grant execute on function public.fn_relatorio_produtos(uuid, timestamptz, timestamptz, text, uuid) to authenticated, service_role;
grant execute on function public.fn_relatorio_templates(uuid, timestamptz, timestamptz, text, text) to authenticated, service_role;
