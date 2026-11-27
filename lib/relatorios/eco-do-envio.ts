/**
 * O ECO DO RELATÓRIO NÃO VIRA CONVERSA.
 *
 * O envio agendado manda o PDF direto pelo canal, sem linha em `messages`. O
 * provedor devolve esse envio como `fromMe`, e a ingestão o trataria como algo
 * que o dono digitou no celular: criaria contato e conversa com o destinatário,
 * pausaria a IA e guardaria o PDF (dado de gestor) onde atendentes veem.
 *
 * Por isso, ANTES de enviar, o envio deixa uma marca (`report_send_marks`,
 * migration 9113) com o nome exato do arquivo, válida por 10 minutos. A
 * ingestão descarta só o `fromMe` que é PDF, tem esse nome e tem marca viva.
 * Falha de leitura NÃO descarta: mensagem perdida some para sempre.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const VALIDADE_DA_MARCA_MS = 10 * 60 * 1000;

export function pareceArquivoDoRelatorio(mime: string | null | undefined, nome: string | null | undefined): boolean {
  return (mime ?? "").toLowerCase().startsWith("application/pdf") && !!nome && /^relatorio-.+\.pdf$/i.test(nome);
}

export async function marcarEnvioDoRelatorio(db: SupabaseClient, organizationId: string, nomeArquivo: string): Promise<void> {
  const { error } = await db.from("report_send_marks").insert({
    organization_id: organizationId,
    nome_arquivo: nomeArquivo,
    expires_at: new Date(Date.now() + VALIDADE_DA_MARCA_MS).toISOString(),
  });
  if (error) throw new Error(`marca do envio não gravada: ${error.message}`);
}

export async function ehEcoDoRelatorio(
  db: SupabaseClient,
  organizationId: string,
  msg: { fromMe: boolean; mime: string | null | undefined; nomeArquivo: string | null | undefined },
): Promise<boolean> {
  if (!msg.fromMe || !pareceArquivoDoRelatorio(msg.mime, msg.nomeArquivo)) return false;
  try {
    const { data, error } = await db
      .from("report_send_marks")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("nome_arquivo", msg.nomeArquivo as string)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (error) return false;
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
