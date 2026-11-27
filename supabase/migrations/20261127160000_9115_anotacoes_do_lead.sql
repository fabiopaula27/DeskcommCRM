-- ============================================================================
-- 9115 — ANOTAÇÕES DO LEAD
--
-- O que o vendedor sabe do lead, por texto ou áudio (transcrito pela IA), em
-- linha do tempo na ficha do contato. Distinta de `conversation_notes` (presa
-- a uma conversa) e de `crm_tasks` (lembrete com prazo).
-- Leitura: a organização. Escrita: agent+. Editar/apagar: o autor, ou manager+.
-- ============================================================================

create table if not exists public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null,
  body text,
  audio_path text,
  audio_mime text,
  audio_duration_s integer,
  source_message_id uuid references public.messages(id) on delete set null,
  transcription_status text not null default 'none',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_notes_kind_check check (kind in ('text','audio')),
  constraint contact_notes_status_check check (transcription_status in ('none','pending','ready','failed','unavailable')),
  constraint contact_notes_texto_nao_vazio check (kind <> 'text' or length(btrim(coalesce(body,''))) > 0),
  constraint contact_notes_audio_tem_arquivo check (kind <> 'audio' or audio_path is not null),
  constraint contact_notes_body_tamanho check (body is null or length(body) <= 20000),
  -- O servidor lê/assina/apaga o áudio com service role: o caminho TEM de
  -- morar na pasta do próprio contato, senão vira acesso a arquivo alheio.
  constraint contact_notes_audio_na_pasta_do_contato check (
    audio_path is null
    or (audio_path like organization_id::text || '/' || contact_id::text || '/%' and position('..' in audio_path) = 0)
  )
);

create index if not exists idx_contact_notes_contato
  on public.contact_notes (contact_id, created_at desc);

alter table public.contact_notes enable row level security;

drop policy if exists contact_notes_select on public.contact_notes;
create policy contact_notes_select on public.contact_notes
  for select using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );

drop policy if exists contact_notes_insert on public.contact_notes;
create policy contact_notes_insert on public.contact_notes
  for insert with check (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'agent')
    and created_by = auth.uid()
    and exists (select 1 from public.contacts c where c.id = contact_id and c.organization_id = contact_notes.organization_id)
  );

drop policy if exists contact_notes_update on public.contact_notes;
create policy contact_notes_update on public.contact_notes
  for update using (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'agent')
  );

-- Na edição só mudam o texto e o estado da transcrição: dono, contato, autor,
-- arquivo e origem ficam como nasceram (a policy não enxerga OLD).
create or replace function public.fn_contact_notes_campos_fixos()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.contact_id is distinct from old.contact_id
     or new.created_by is distinct from old.created_by
     or new.kind is distinct from old.kind
     or new.audio_path is distinct from old.audio_path
     or new.audio_mime is distinct from old.audio_mime
     or new.source_message_id is distinct from old.source_message_id
     or new.created_at is distinct from old.created_at then
    raise exception 'contact_notes: só o texto e a transcrição podem mudar' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contact_notes_campos_fixos on public.contact_notes;
create trigger trg_contact_notes_campos_fixos
  before update on public.contact_notes
  for each row execute function public.fn_contact_notes_campos_fixos();

drop policy if exists contact_notes_delete on public.contact_notes;
create policy contact_notes_delete on public.contact_notes
  for delete using (
    (organization_id in (select public.fn_user_org_ids()))
    and public.fn_role_at_least(organization_id, 'agent')
    and (created_by = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.contact_notes from anon;
grant select, insert, update, delete on public.contact_notes to authenticated;
grant all on public.contact_notes to service_role;

drop trigger if exists trg_contact_notes_updated_at on public.contact_notes;
create trigger trg_contact_notes_updated_at
  before update on public.contact_notes
  for each row execute function public.fn_set_updated_at();

-- Áudios das anotações: privado, lido por link assinado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-notes', 'contact-notes', false, 26214400, null)
on conflict (id) do nothing;

-- LGPD: anonimizar o contato apaga as anotações dele (texto livre sobre a
-- pessoa). Mesmo gancho da 0210: a transição is_anonymized false → true.
create or replace function public.fn_apagar_anotacoes_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.contact_notes
   where organization_id = new.organization_id
     and contact_id = new.id;
  return new;
end;
$$;

revoke execute on function public.fn_apagar_anotacoes_do_contato_anonimizado() from public, anon, authenticated;
grant  execute on function public.fn_apagar_anotacoes_do_contato_anonimizado() to service_role;

drop trigger if exists trg_apagar_anotacoes_ao_anonimizar on public.contacts;
create trigger trg_apagar_anotacoes_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (old.is_anonymized is distinct from true and new.is_anonymized = true)
  execute function public.fn_apagar_anotacoes_do_contato_anonimizado();

notify pgrst, 'reload schema';
