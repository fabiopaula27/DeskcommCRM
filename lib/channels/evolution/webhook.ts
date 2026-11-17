/**
 * Leitura do corpo cru do webhook da Evolution API (v2.x).
 *
 * Envelope validado com zod (so o que o leitor depende: `event` e `instance`
 * como string); `data` varia por evento e e lido de forma defensiva. A recusa
 * nomeia CAMPOS, nunca valores (mesma postura de `zernio/envelope.ts`).
 *
 * O corpo traz o nome do evento em minusculas com ponto (`messages.upsert`);
 * normalizamos tambem `MESSAGES_UPSERT`. O filtro de timestamp vs. connected_at
 * NAO e daqui: o parser so expoe `timestamp`.
 */
import { z } from "zod";

import { lerEnvelope } from "@/lib/webhooks/contrato";

const envelopeSchema = z.looseObject({
  event: z.string(),
  instance: z.string(),
  data: z.unknown().optional(),
});

export type EvolutionMidiaTipo = "image" | "video" | "audio" | "document";

export type EvolutionEvento =
  | {
      tipo: "mensagem";
      instancia: string;
      externalId: string;
      de: { telefone: string | null; lid: string | null; nome: string | null };
      fromMe: boolean;
      /** null = ausente/invalido; o consumidor trata como "nao fresca". */
      timestamp: Date | null;
      texto: string | null;
      midia: {
        tipo: EvolutionMidiaTipo;
        mimetype: string;
        base64: string | null;
        nomeArquivo: string | null;
      } | null;
    }
  | {
      tipo: "status";
      instancia: string;
      externalId: string;
      status: "sent" | "delivered" | "read" | "failed";
    }
  | {
      tipo: "conexao";
      instancia: string;
      estado: "open" | "connecting" | "close";
      telefone: string | null;
    }
  | { tipo: "qr"; instancia: string; qrBase64: string }
  | {
      tipo: "ignorado";
      instancia: string;
      motivo: "grupo" | "broadcast" | "evento_sem_interesse";
    };

export type LeituraEvolution =
  | { ok: true; evento: EvolutionEvento }
  | { ok: false; motivo: "json_invalido" | "contrato"; campos: string[] };

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

const MIDIAS: Array<[string, EvolutionMidiaTipo]> = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
];

/** "5511...@s.whatsapp.net" -> "5511..." ; outros dominios -> null. */
function telefoneDoJid(jid: string | null): string | null {
  if (!jid) return null;
  const m = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m?.[1] ?? null;
}

function timestampDe(v: unknown): Date | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d+$/.test(v)) n = Number(v);
  else {
    const o = obj(v);
    if (o && typeof o.low === "number") n = o.low;
  }
  return n !== null && Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

function lerMensagem(instancia: string, data: Obj): EvolutionEvento {
  const key = obj(data.key);
  const remoteJid = str(key?.remoteJid);
  if (remoteJid?.endsWith("@g.us")) return { tipo: "ignorado", instancia, motivo: "grupo" };
  if (remoteJid?.endsWith("@broadcast")) {
    return { tipo: "ignorado", instancia, motivo: "broadcast" };
  }
  const externalId = str(key?.id);
  if (!key || !remoteJid || !externalId) {
    return { tipo: "ignorado", instancia, motivo: "evento_sem_interesse" };
  }

  const message = obj(data.message) ?? {};
  let texto: string | null = str(message.conversation) ?? str(obj(message.extendedTextMessage)?.text);
  let midia: Extract<EvolutionEvento, { tipo: "mensagem" }>["midia"] = null;

  for (const [campo, tipo] of MIDIAS) {
    const m = obj(message[campo]);
    if (!m) continue;
    midia = {
      tipo,
      mimetype: str(m.mimetype) ?? "application/octet-stream",
      base64: str(message.base64) ?? str(data.base64),
      nomeArquivo: str(m.fileName),
    };
    texto = texto ?? str(m.caption);
    break;
  }

  const ehLid = remoteJid.endsWith("@lid");
  const telefone = ehLid
    ? (telefoneDoJid(str(key.remoteJidAlt)) ?? telefoneDoJid(str(key.senderPn)))
    : telefoneDoJid(remoteJid);

  return {
    tipo: "mensagem",
    instancia,
    externalId,
    de: { telefone, lid: ehLid ? remoteJid : null, nome: str(data.pushName) },
    fromMe: key.fromMe === true,
    timestamp: timestampDe(data.messageTimestamp),
    texto,
    midia,
  };
}

const STATUS: Record<string, "sent" | "delivered" | "read" | "failed" | undefined> = {
  SERVER_ACK: "sent",
  DELIVERY_ACK: "delivered",
  READ: "read",
  PLAYED: "read",
  ERROR: "failed",
};

function lerStatus(instancia: string, data: Obj): EvolutionEvento {
  const ignorado = { tipo: "ignorado", instancia, motivo: "evento_sem_interesse" } as const;
  const jid = str(data.remoteJid) ?? str(obj(data.key)?.remoteJid);
  if (jid?.endsWith("@g.us")) return { tipo: "ignorado", instancia, motivo: "grupo" };
  if (jid?.endsWith("@broadcast")) return { tipo: "ignorado", instancia, motivo: "broadcast" };
  const externalId = str(data.keyId) ?? str(obj(data.key)?.id);
  const bruto = str(data.status);
  const status = bruto ? STATUS[bruto.toUpperCase()] : undefined;
  if (!externalId || !status) return ignorado;
  return { tipo: "status", instancia, externalId, status };
}

function lerConexao(instancia: string, data: Obj): EvolutionEvento {
  const state = str(data.state);
  if (state !== "open" && state !== "connecting" && state !== "close") {
    return { tipo: "ignorado", instancia, motivo: "evento_sem_interesse" };
  }
  return { tipo: "conexao", instancia, estado: state, telefone: telefoneDoJid(str(data.wuid)) };
}

function lerQr(instancia: string, data: Obj): EvolutionEvento {
  const qrBase64 = str(obj(data.qrcode)?.base64) ?? str(data.base64);
  if (!qrBase64) return { tipo: "ignorado", instancia, motivo: "evento_sem_interesse" };
  return { tipo: "qr", instancia, qrBase64 };
}

export function lerEventoEvolution(raw: string): LeituraEvolution {
  const l = lerEnvelope(raw, envelopeSchema);
  if (!l.ok) {
    return {
      ok: false,
      motivo: l.motivo === "json_invalido" ? "json_invalido" : "contrato",
      campos: l.campos,
    };
  }
  const { event, instance, data } = l.envelope;
  const d = obj(data) ?? {};
  const nome = event.trim().toLowerCase().replace(/_/g, ".");

  let evento: EvolutionEvento;
  switch (nome) {
    case "messages.upsert":
      evento = lerMensagem(instance, d);
      break;
    case "messages.update":
      evento = lerStatus(instance, d);
      break;
    case "connection.update":
      evento = lerConexao(instance, d);
      break;
    case "qrcode.updated":
      evento = lerQr(instance, d);
      break;
    default:
      evento = { tipo: "ignorado", instancia: instance, motivo: "evento_sem_interesse" };
  }
  return { ok: true, evento };
}
