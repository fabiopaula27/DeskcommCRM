/**
 * A agenda do Google de QUEM ESTÁ USANDO o sistema perdeu a conexão?
 *
 * Com a conexão caída nada sincroniza: compromissos marcados no Google não
 * chegam ao CRM e a disponibilidade fica cega. A faixa vermelha do topo
 * (`AgendaGoogleCaidaBanner`) avisa até a pessoa reconectar.
 * Leitura que falha devolve `null`: a casca do app nunca cai por causa disto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const STATUS_CAIDOS = new Set(["token_expired", "scope_missing", "disconnected", "error"]);

export function conexaoDaAgendaCaiu(status: string | null | undefined): boolean {
  return STATUS_CAIDOS.has(status ?? "");
}

export type AgendaCaida = { email: string | null };

export async function agendaGoogleCaida(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<AgendaCaida | null> {
  try {
    const { data, error } = await db
      .from("calendar_connections")
      .select("account_email, status")
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    if (error || !data) return null;
    const caida = (data as { account_email: string | null; status: string }[]).find((c) => conexaoDaAgendaCaiu(c.status));
    return caida ? { email: caida.account_email } : null;
  } catch {
    return null;
  }
}
