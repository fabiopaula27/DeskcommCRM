/**
 * Webhook da Meta para Messenger (`object=page`) e Instagram Direct
 * (`object=instagram`) → eventos de mensagem. PURO: decide só o que o payload
 * diz. Leitura, entrega, reação e qualquer outro evento são ignorados.
 *
 * `contaId` é o `entry.id` (página ou conta IG) — é por ele que o webhook acha
 * o canal e a organização. O lead é quem mandou; no ECO (mensagem que a página
 * mandou, inclusive pelo próprio CRM) o lead é o destinatário.
 */
import { socialMessageId } from "../social/catalog";
import type { SocialMessage } from "../social/parser";

export type PlataformaSocial = "facebook" | "instagram";

export type EventoSocial = {
  plataforma: PlataformaSocial;
  contaId: string;
  leadId: string;
  mid: string;
  texto: string | null;
  anexos: { type: string; url: string }[];
  eco: boolean;
  /** No eco do Messenger: o app que enviou. Igual ao app do CRM = envio do próprio CRM. */
  appId: string | null;
  em: string | null;
  referral: unknown | null;
};

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parsearEventos(payload: unknown): EventoSocial[] {
  const raiz = obj(payload);
  const plataforma: PlataformaSocial | null =
    raiz?.object === "page" ? "facebook" : raiz?.object === "instagram" ? "instagram" : null;
  if (!raiz || !plataforma || !Array.isArray(raiz.entry)) return [];

  const eventos: EventoSocial[] = [];
  for (const entrada of raiz.entry) {
    const e = obj(entrada);
    const contaId = str(e?.id);
    if (!e || !contaId || !Array.isArray(e.messaging)) continue;
    for (const item of e.messaging) {
      const m = obj(item);
      const msg = obj(m?.message);
      const mid = str(msg?.mid);
      if (!m || !msg || !mid) continue;
      const eco = msg.is_echo === true;
      const leadId = str(obj(eco ? m.recipient : m.sender)?.id);
      if (!leadId) continue;
      const anexos = (Array.isArray(msg.attachments) ? msg.attachments : [])
        .map((a) => {
          const ao = obj(a);
          const url = str(obj(ao?.payload)?.url);
          if (!ao || !url || ao.type === "fallback") return null;
          return { type: str(ao.type) ?? "file", url };
        })
        .filter((a): a is { type: string; url: string } => a !== null);
      const ts = typeof m.timestamp === "number" ? m.timestamp : null;
      eventos.push({
        plataforma,
        contaId,
        leadId,
        mid,
        texto: str(msg.text),
        anexos,
        eco,
        appId: msg.app_id === undefined || msg.app_id === null ? null : String(msg.app_id),
        em: ts ? new Date(ts).toISOString() : null,
        referral: m.referral ?? msg.referral ?? null,
      });
    }
  }
  return eventos;
}

/**
 * Evento → mensagem do ingest social que já existe (contato, conversa, Inbox,
 * IA, automações). A thread é o id do lead: é o endereço do envio depois.
 */
export function paraMensagemDoIngest(e: EventoSocial): SocialMessage {
  return {
    platform: e.plataforma,
    participantId: e.leadId,
    accountId: e.contaId,
    conversationId: e.leadId,
    externalId: socialMessageId(e.contaId, e.mid),
    direction: e.eco ? "outbound" : "inbound",
    kind: "message",
    text: e.texto,
    sentAt: e.em,
    attachments: e.anexos,
    referral: e.referral,
    identity: { phone: null, bsuid: null, anchor: null, username: null, displayName: null },
  };
}
