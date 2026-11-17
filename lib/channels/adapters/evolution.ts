/**
 * Adapter do canal Evolution API v2 (WhatsApp por QR/Baileys), so saida.
 *
 * `sessionRef` e o nome da instancia (`dc-<uuid sem hifens>`). O `externalId`
 * devolvido e o `key.id` da Evolution — o eco `fromMe` do webhook deduplica por
 * ele. Erros do cliente viram `Error(evolution_<codigo>)`: so o codigo, nunca
 * URL, corpo ou apikey.
 *
 * `fetchInboundMedia` fica de fora de proposito: a midia de entrada ja e
 * persistida no webhook (base64 inline), entao a rota de midia nunca precisa
 * buscar nada no servidor para mensagens deste canal.
 */
import { createEvolutionClient, EvolutionError, type EvolutionClient } from "../evolution/client";
import { evolutionConfigurado } from "../evolution/credentials";
import type { ChannelAdapter, ChannelHealth, OutboundEnvelope, RecipientInput } from "../types";

const TIPOS_DE_MIDIA = ["image", "video", "audio", "document"] as const;
type TipoDeMidia = (typeof TIPOS_DE_MIDIA)[number];

function codigoDoErro(err: unknown): string {
  return err instanceof EvolutionError ? `evolution_${err.code}` : "evolution_error";
}

async function comTraducaoDeErro<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(codigoDoErro(err));
  }
}

function numeroDoContato(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  // 10-11 digitos = DDD + numero brasileiro sem DDI.
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

export const evolutionAdapter: ChannelAdapter = {
  provider: "evolution",

  resolveRecipient(input: RecipientInput): string | null {
    if (input.isGroup || !input.phoneNumber) return null;
    return numeroDoContato(input.phoneNumber);
  },

  isConfigured: evolutionConfigurado,

  async send(envelope: OutboundEnvelope): Promise<{ externalId: string | null }> {
    const client: EvolutionClient | null = createEvolutionClient();
    // Throw, nao noop: o handler enfileira (`queued`) em vez de marcar `sent`.
    if (!client) throw new Error(evolutionAdapter.codes.notConfigured);

    const midia = envelope.media;
    if (midia) {
      if (!(TIPOS_DE_MIDIA as readonly string[]).includes(envelope.kind)) {
        throw new Error("evolution_unsupported_kind");
      }
      await envelope.beforeSend?.();
      return comTraducaoDeErro(() =>
        client.enviarMidia({
          nome: envelope.sessionRef,
          numero: envelope.to,
          tipo: envelope.kind as TipoDeMidia,
          base64OuUrl: midia.url,
          mimetype: midia.mime,
          ...(midia.filename ? { nomeArquivo: midia.filename } : {}),
          ...(midia.caption ? { legenda: midia.caption } : {}),
        }),
      );
    }

    if (envelope.kind !== "text") throw new Error("evolution_unsupported_kind");
    await envelope.beforeSend?.();
    return comTraducaoDeErro(() =>
      client.enviarTexto({
        nome: envelope.sessionRef,
        numero: envelope.to,
        texto: envelope.body ?? "",
      }),
    );
  },

  async checkHealth(input: { sessionRef: string }): Promise<ChannelHealth> {
    const client = createEvolutionClient();
    if (!client) return { reachable: false, status: null, detail: "transporte_nao_configurado" };
    try {
      const s = await client.estado(input.sessionRef);
      const status = s === "open" ? "WORKING" : s === "connecting" ? "STARTING" : "STOPPED";
      return { reachable: true, status, detail: null };
    } catch (err) {
      return { reachable: false, status: null, detail: codigoDoErro(err) };
    }
  },

  codes: {
    notConfigured: "evolution_not_configured",
    sendFailed: "evolution_error",
    unknownError: "evolution_unknown",
  },
};
