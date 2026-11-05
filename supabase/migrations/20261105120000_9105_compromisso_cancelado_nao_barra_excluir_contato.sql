-- manifest: **Compromisso cancelado deixa de impedir a exclusão do contato.** `fn_apagar_contato_com_historico` solta (`contact_id` e `conversation_id` nulos) os compromissos com status `cancelled` antes de apagar a ficha, na mesma transação; o compromisso segue na Agenda. Antes, cancelar na Agenda — o que a tela mandava fazer — não bastava, e só apagar pelo banco resolvia.
--
-- 9105 — compromisso ativo continua barrando pelo RESTRICT da 0177.

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
  -- Compromisso CANCELADO não barra a exclusão (9105): sai da ficha e da
  -- conversa (o gatilho de escopo exige os dois juntos) e segue na Agenda.
  -- Compromisso ativo continua barrando pelo RESTRICT da 0177.
  update public.calendar_appointments
     set contact_id = null, conversation_id = null
   where contact_id = p_contact_id
     and organization_id = p_organization_id
     and status = 'cancelled';

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
