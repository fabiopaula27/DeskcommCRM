/**
 * Webhook próprio de cada sessão do WAHA.
 *
 * `WHATSAPP_HOOK_URL` é uma só para o WAHA inteiro. Com a rota por token nela,
 * toda sessão entrega com o token de UM canal, e a mensagem de outro tenant era
 * gravada na organização dona desse token. Por isso:
 *
 *  - `WAHA_WEBHOOK_SESSION_BASE_URL` preenchida: cada sessão recebe no WAHA a URL
 *    com o token dela. Vazia (compose padrão, rede interna, rota global que
 *    resolve por `session`): nada muda.
 *  - a rota por token recusa evento de outra sessão, com qualquer configuração.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { WahaClient } from "@/lib/waha/client";

/** Os mesmos de `WHATSAPP_HOOK_EVENTS` no compose. */
export const EVENTOS_DO_WEBHOOK_DA_SESSAO = [
  "message.any", "message.ack", "message.edited", "message.revoked",
  "message.reaction", "session.status", "state.change",
];

/** Trecho que identifica um webhook nosso entre os da sessão. */
export const CAMINHO_DO_WEBHOOK_WAHA = "/api/v1/webhooks/waha";

/** Mesmo piso de `lib/waha/webhook-auth.ts`: abaixo disso é placeholder. */
const MIN_SECRET_LEN = 16;

export function montarUrlDoWebhookDaSessao(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${CAMINHO_DO_WEBHOOK_WAHA}/${token}`;
}

/** Corpo sem `session` segue: o token continua sendo quem autentica. */
export function eventoDeOutraSessao(corpo: Readonly<Record<string, unknown>>, nomeDaSessao: string): boolean {
  return typeof corpo.session === "string" && corpo.session !== "" && corpo.session !== nomeDaSessao;
}

/**
 * Aponta a sessão para o token do canal. Nunca lança: falha aqui não pode
 * derrubar a conexão do número, e o log diz o que ficou por fazer.
 */
export async function sincronizarWebhookDaSessao(
  db: SupabaseClient,
  garantir: WahaClient["garantirWebhookDaSessao"] | undefined,
  alvo: { organizationId: string; channelSessionId: string; sessionRef: string },
): Promise<void> {
  const baseUrl = env.WAHA_WEBHOOK_SESSION_BASE_URL.trim();
  if (!baseUrl || !garantir) return;
  try {
    const { data, error } = await db.from("channel_sessions")
      .select("webhook_path_token, webhook_secret_encrypted")
      .eq("organization_id", alvo.organizationId).eq("id", alvo.channelSessionId)
      .maybeSingle();
    const canal = data as { webhook_path_token?: string | null; webhook_secret_encrypted?: unknown } | null;
    if (error || !canal?.webhook_path_token) throw new Error("canal_sem_token");

    // A assinatura tem de ser a que `authenticateWahaWebhook` vai conferir.
    let segredo: string | null = null;
    if (canal.webhook_secret_encrypted) {
      const dec = await db.rpc("fn_decrypt_oauth", { ciphertext: canal.webhook_secret_encrypted });
      if (typeof dec.data === "string" && dec.data.length >= MIN_SECRET_LEN) segredo = dec.data;
    }
    segredo ??= env.WAHA_HMAC_SECRET.trim().length >= MIN_SECRET_LEN ? env.WAHA_HMAC_SECRET.trim() : null;

    const url = montarUrlDoWebhookDaSessao(baseUrl, canal.webhook_path_token);
    if (!(await garantir(alvo.sessionRef, url, segredo))) throw new Error("waha_recusou");
  } catch (err) {
    logger.warn("[waha] sessão ficou sem webhook próprio", {
      channel_session_id: alvo.channelSessionId,
      erro: err instanceof Error ? err.message : "unknown",
    });
  }
}
