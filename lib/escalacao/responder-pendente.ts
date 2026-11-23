/**
 * Devolveu a conversa à IA e a última mensagem é do CLIENTE, sem resposta
 * depois dela? A IA responde agora — o mesmo despacho que a chegada da
 * mensagem faria (`ai_agent.dispatch_requested`, ver `lib/channels/pos-entrada.ts`).
 *
 * Se a última mensagem é da equipe (ex.: "ainda está por aí?"), nada acontece:
 * quem fala agora é o cliente. O drain continua aplicando todas as barreiras
 * (inbound mais recente, elegibilidade, canal desligado, turno já respondido).
 *
 * Nunca lança: a devolução já aconteceu, e isto é um efeito a mais.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

interface UltimaMensagem {
  id: string;
  direction: string | null;
}

export function deveResponderPendente(ultima: UltimaMensagem | null): boolean {
  return ultima !== null && ultima.direction === "inbound";
}

export async function responderMensagemPendenteDoCliente(
  supabase: SupabaseClient,
  p: { organizationId: string; conversationId: string; contactId: string | null; requestId: string },
): Promise<boolean> {
  try {
    const { data: conv } = await supabase
      .from("conversations")
      .select("channel_session_id")
      .eq("id", p.conversationId)
      .eq("organization_id", p.organizationId)
      .maybeSingle();
    const canal = (conv as { channel_session_id?: string | null } | null)?.channel_session_id ?? null;
    if (!canal || !p.contactId) return false;

    const { data: msgs } = await supabase
      .from("messages")
      .select("id, direction")
      .eq("organization_id", p.organizationId)
      .eq("conversation_id", p.conversationId)
      .order("sent_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    const ultima = (Array.isArray(msgs) ? msgs[0] : null) as UltimaMensagem | null;
    if (!deveResponderPendente(ultima ?? null)) return false;

    const { error } = await supabase.rpc("emit_event" as never, {
      p_event_type: "ai_agent.dispatch_requested",
      p_entity_kind: "message",
      p_entity_id: ultima!.id,
      p_payload: {
        organization_id: p.organizationId,
        conversation_id: p.conversationId,
        contact_id: p.contactId,
        channel_session_id: canal,
        inbound_message_id: ultima!.id,
      },
      p_metadata: { source: "escalacao.retomada", request_id: p.requestId },
      p_organization_id: p.organizationId,
    } as never);
    if (error) {
      logger.warn("[escalacao.retomada] despacho da mensagem pendente falhou", {
        conversation_id: p.conversationId,
        error: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("[escalacao.retomada] leitura da mensagem pendente falhou", {
      conversation_id: p.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
