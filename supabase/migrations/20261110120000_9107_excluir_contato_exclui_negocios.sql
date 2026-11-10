-- manifest: excluir contato também exclui os negócios dele no funil (antes ficavam órfãos, contact_id nulo)

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

  -- 9107: os negócios do contato saem junto. A FK é SET NULL, e sem isto o card
  -- ficava no funil sem dono. Os filhos de crm_leads são CASCADE/SET NULL.
  delete from public.crm_leads
   where contact_id = p_contact_id
     and organization_id = p_organization_id;

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
