/**
 * Uma entrega do webhook da Meta (Messenger/Instagram) → mensagens no Inbox.
 *
 * Quem decide a ORGANIZAÇÃO é o canal ativo da conta (`entry.id`), nunca o
 * corpo: a mesma conta só pode estar ativa em uma organização (índice único da
 * migration 9116). Conta sem canal é ignorada. Um evento que falha não derruba
 * os outros, e nada aqui devolve erro à Meta (ela reentregaria para sempre).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { ingestZernioInbound } from "../zernio/ingest";
import { paraMensagemDoIngest, parsearEventos, type PlataformaSocial } from "./parser";

export const PROVIDER_META_SOCIAL = "meta_social";

export type SessaoDaConta = { id: string; organization_id: string };

export async function sessaoDaConta(
  db: SupabaseClient,
  contaId: string,
  plataforma: PlataformaSocial,
): Promise<SessaoDaConta | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, organization_id")
    .eq("provider", PROVIDER_META_SOCIAL)
    .eq("meta_social_account_id", contaId)
    .eq("meta_social_platform", plataforma)
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new Error(`meta_social_sessao: ${error.message}`);
  return (data as SessaoDaConta | null) ?? null;
}

export type ResultadoDaEntrega = { recebidos: number; gravados: number; ignorados: number; falhas: number };

export async function processarEntrega(
  db: SupabaseClient,
  payload: unknown,
  deps: { ingerir?: typeof ingestZernioInbound; sessao?: typeof sessaoDaConta } = {},
): Promise<ResultadoDaEntrega> {
  const ingerir = deps.ingerir ?? ingestZernioInbound;
  const acharSessao = deps.sessao ?? sessaoDaConta;
  const eventos = parsearEventos(payload);
  const r: ResultadoDaEntrega = { recebidos: eventos.length, gravados: 0, ignorados: 0, falhas: 0 };
  for (const e of eventos) {
    try {
      const sessao = await acharSessao(db, e.contaId, e.plataforma);
      if (!sessao) {
        r.ignorados++;
        continue;
      }
      await ingerir(db, {
        organizationId: sessao.organization_id,
        channelSessionId: sessao.id,
        payload,
        socialMessage: paraMensagemDoIngest(e),
      });
      r.gravados++;
    } catch (err) {
      r.falhas++;
      logger.error("[meta-social] evento não gravado", {
        conta: e.contaId,
        plataforma: e.plataforma,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return r;
}
