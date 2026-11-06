-- manifest: **Compromisso cancelado marcado pelo agente também deixa de impedir a exclusão do contato.** Nova `fn_soltar_compromissos_cancelados_do_contato` (security definer, confere papel agent+ e escrita de suporte na organização) solta os cancelados — inclusive os de serviço, que a policy restritiva e o guarda recusavam à sessão do usuário — e `fn_apagar_contato_com_historico` passa a chamá-la.
--
-- 9106 — corrige a 9105, que só alcançava compromisso criado pela tela.

-- O compromisso que o AGENTE marca nasce como serviço (`service_occurrence_id`
-- preenchido). A policy restritiva de UPDATE e o gatilho
-- `fn_calendar_service_appointment_guard` recusam alteração de serviço feita
-- por sessão de usuário — então o UPDATE da 9105, `security invoker`, não
-- alcançava esses compromissos e a exclusão do contato seguia barrada.
--
-- Esta função faz só isso, como o sistema faria: confere o papel de quem chama
-- na organização, solta (contact_id/conversation_id nulos) SÓ os compromissos
-- CANCELADOS daquele contato naquela organização, e devolve a identidade da
-- sessão. Cancelado não ocupa agenda, então o guarda não revalida nada.
create or replace function public.fn_soltar_compromissos_cancelados_do_contato(
  p_contact_id uuid,
  p_organization_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_n integer;
begin
  if auth.uid() is not null and (
       not public.fn_role_at_least(p_organization_id, 'agent')
       or not public.fn_support_write_allowed(p_organization_id)) then
    raise exception 'contact_delete_forbidden' using errcode = '42501';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  update public.calendar_appointments
     set contact_id = null, conversation_id = null
   where contact_id = p_contact_id
     and organization_id = p_organization_id
     and status = 'cancelled';
  get diagnostics v_n = row_count;

  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_n;
end;
$$;

revoke execute on function public.fn_soltar_compromissos_cancelados_do_contato(uuid, uuid) from public, anon;
grant  execute on function public.fn_soltar_compromissos_cancelados_do_contato(uuid, uuid) to authenticated, service_role;

create or replace function public.fn_apagar_contato_com_historico(
  p_contact_id uuid,
  p_organization_id uuid
)
returns boolean
language plpgsql
volatile
security invoker
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Compromisso CANCELADO não barra a exclusão (9105/9106): sai da ficha e da
  -- conversa e segue na Agenda. Ativo continua barrando pelo RESTRICT da 0177.
  perform public.fn_soltar_compromissos_cancelados_do_contato(p_contact_id, p_organization_id);

  -- RESTRICT da #752: o histórico sai antes da ficha, na mesma transação.
  delete from public.messages
   where contact_id = p_contact_id
     and organization_id = p_organization_id;

  delete from public.conversations
   where contact_id = p_contact_id
     and organization_id = p_organization_id;

  delete from public.contacts
   where id = p_contact_id
     and organization_id = p_organization_id;

  -- `found` é do DELETE da ficha: false = a ficha não estava acessível para quem
  -- chamou (outra organização, RLS, corrida) — a rota devolve 404 nesse caso.
  return found;
end;
$$;

revoke execute on function public.fn_apagar_contato_com_historico(uuid, uuid) from public, anon;
grant  execute on function public.fn_apagar_contato_com_historico(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
