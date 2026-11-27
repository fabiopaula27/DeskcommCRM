/**
 * Messenger e Instagram Direct pela conexão DIRETA com a Meta (Send API).
 *
 * Endereço = id do lead naquela página/IG (PSID/IGSID), que chega no webhook e
 * mora em `conversations.provider_conversation_id`. Token = o da página.
 * O id devolvido segue o formato do ingest social (`social:<conta>:<mid>`)
 * para o ECO do próprio envio casar com a linha já gravada, sem duplicar.
 */
import { MAX_MEDIA_BYTES, MediaTooLargeError } from "@/lib/messaging/media/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { credencialDaConta } from "../meta-social/credenciais";
import { ErroGraph, foraDaJanela, graphSocial, pessoaIndisponivel, tokenCaiu } from "../meta-social/graph";
import { socialMessageId } from "../social/catalog";
import type { ChannelAdapter, OutboundEnvelope } from "../types";

export const MENSAGEM_FORA_DA_JANELA =
  "A Meta só permite responder até 24h depois da última mensagem do lead. Espere ele escrever de novo.";
export const MENSAGEM_TOKEN_CAIU =
  "A conexão com a página caiu (senha trocada ou permissão retirada). Reconecte em Conexões › Redes sociais.";

export const MENSAGEM_PESSOA_INDISPONIVEL =
  "Esta pessoa não está disponível no Messenger/Instagram agora (pode ter bloqueado a página).";

/** Tipo do envio → tipo de anexo da Send API. */
export function tipoDoAnexo(kind: string, mime: string): "image" | "audio" | "video" | "file" {
  if (kind === "image" || mime.startsWith("image/")) return "image";
  if (kind === "audio" || kind === "voice" || mime.startsWith("audio/")) return "audio";
  if (kind === "video" || mime.startsWith("video/")) return "video";
  return "file";
}

/** O corpo (ou corpos) da Send API para um envelope. Legenda vai como texto à parte. */
export function corposDoEnvio(envelope: Pick<OutboundEnvelope, "kind" | "body" | "media">, leadId: string): Record<string, unknown>[] {
  const recipient = { id: leadId };
  if (envelope.media) {
    const anexo = {
      recipient,
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: tipoDoAnexo(envelope.kind, envelope.media.mime),
          payload: { url: envelope.media.url, is_reusable: false },
        },
      },
    };
    const legenda = (envelope.media.caption ?? envelope.body ?? "").trim();
    return legenda ? [anexo, { recipient, messaging_type: "RESPONSE", message: { text: legenda } }] : [anexo];
  }
  return [{ recipient, messaging_type: "RESPONSE", message: { text: envelope.body ?? "" } }];
}

function traduzirErro(e: unknown): Error {
  if (foraDaJanela(e)) return new Error(`meta_social_fora_da_janela: ${MENSAGEM_FORA_DA_JANELA}`);
  if (tokenCaiu(e)) return new Error(`meta_social_token_invalido: ${MENSAGEM_TOKEN_CAIU}`);
  if (pessoaIndisponivel(e)) return new Error(`meta_social_pessoa_indisponivel: ${MENSAGEM_PESSOA_INDISPONIVEL}`);
  if (e instanceof ErroGraph) return new Error(`meta_social_send_failed: ${e.status} ${e.code ?? ""}/${e.subcode ?? ""} ${e.message}`.trim());
  return e instanceof Error ? e : new Error(String(e));
}

export const metaSocialAdapter: ChannelAdapter = {
  provider: "meta_social",
  resolveRecipient: (input) => (input.isGroup ? null : "provider-thread"),
  isConfigured: () => true,
  codes: { notConfigured: "meta_social_not_configured", sendFailed: "meta_social_send_failed", unknownError: "meta_social_error" },

  async send(envelope) {
    if (envelope.kind === "contact") throw new Error("meta_social_contact_not_supported: cartão de contato não existe no Messenger/Instagram.");
    if (!envelope.providerConversationId) {
      throw new Error("meta_social_no_conversation: só dá para responder quem já escreveu para a página ou o Instagram.");
    }
    const cred = await credencialDaConta(createAdminClient(), envelope.organizationId, envelope.sessionRef);
    if (!cred) throw new Error(`meta_social_not_configured: ${MENSAGEM_TOKEN_CAIU}`);

    await envelope.beforeSend?.();
    let primeiro: string | null = null;
    for (const corpo of corposDoEnvio(envelope, envelope.providerConversationId)) {
      try {
        const r = await graphSocial<{ message_id?: string }>(cred.token, `${cred.paginaId}/messages`, { method: "POST", body: corpo });
        primeiro ??= r.message_id ?? null;
      } catch (e) {
        throw traduzirErro(e);
      }
    }
    return { externalId: primeiro ? socialMessageId(envelope.sessionRef, primeiro) : null };
  },

  async checkHealth(input) {
    const cred = await credencialDaConta(createAdminClient(), input.organizationId, input.sessionRef);
    if (!cred) return { reachable: true, status: "FAILED", detail: "reconectar" };
    try {
      await graphSocial(cred.token, input.sessionRef, { params: { fields: "id" } });
      return { reachable: true, status: "WORKING", detail: null };
    } catch (e) {
      // Só token caído pede reconectar. Limite de uso (4, 17, 32, 613) e
      // permissão passageira também voltam 4xx, e não são canal caído.
      if (tokenCaiu(e)) return { reachable: true, status: "FAILED", detail: "reconectar" };
      return { reachable: false, status: null, detail: "meta_indisponivel" };
    }
  },

  /** Os anexos do Messenger/Instagram vêm de URL assinada da CDN da Meta: baixa sem token. */
  async fetchInboundMedia(input) {
    const res = await fetch(input.url);
    if (!res.ok) throw new Error(`meta_social_media_${res.status}`);
    const declarado = Number(res.headers.get("content-length") ?? 0);
    if (declarado > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_MEDIA_BYTES) throw new MediaTooLargeError();
    const mime = (res.headers.get("content-type") ?? input.hintMime ?? "application/octet-stream").split(";")[0]!.trim();
    return { buffer, mime };
  },
};
