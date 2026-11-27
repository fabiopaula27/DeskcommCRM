-- 9113 — Relatórios (parte 4): envio agendado do relatório em PDF.
-- Uma linha por organização. Leitura e escrita só pelo servidor (service role),
-- depois de conferir que quem pede é dono/admin: a tabela não tem policy para
-- `authenticated`, então o PostgREST não a entrega a ninguém direto.

create table if not exists public.report_schedules (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ativo boolean not null default true,
  frequencia text not null default 'diario',
  horario time not null default '08:00',
  emails text[] not null default '{}',
  telefones text[] not null default '{}',
  channel_session_id uuid references public.channel_sessions(id) on delete set null,
  ultimo_periodo text,
  ultimo_envio_em timestamptz,
  ultimo_erro text,
  tentativas_do_periodo int not null default 0,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_schedules_frequencia check (frequencia in ('diario', 'semanal', 'mensal')),
  constraint report_schedules_max_emails check (cardinality(emails) <= 20),
  constraint report_schedules_max_telefones check (cardinality(telefones) <= 20)
);

alter table public.report_schedules enable row level security;
revoke all on table public.report_schedules from anon, authenticated;

-- PDFs gerados para o envio por WhatsApp: privado, link assinado de curta duração.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorios', 'relatorios', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
