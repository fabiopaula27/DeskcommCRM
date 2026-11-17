/**
 * Cliente HTTP da Evolution API v2 (servidor da instalacao, uma instancia por
 * canal). A apikey global so vai no header `apikey`; nunca em log nem em
 * mensagem de erro (mensagens aqui nao incluem URL completa nem corpo).
 */
import { evolutionCredenciais } from "./credentials";

export type EvolutionErrorCode = "nao_configurado" | "indisponivel" | "recusado" | "nao_encontrado";

export class EvolutionError extends Error {
  readonly code: EvolutionErrorCode;
  constructor(code: EvolutionErrorCode, message: string) {
    super(message);
    this.name = "EvolutionError";
    this.code = code;
  }
}

export type EvolutionEstado = "open" | "connecting" | "close" | "inexistente";

export interface EvolutionClient {
  criarInstancia(a: {
    nome: string;
    webhookUrl: string;
    webhookSecret: string;
  }): Promise<{ qrBase64: string | null }>;
  conectar(nome: string): Promise<{ qrBase64: string | null; pairingCode: string | null }>;
  estado(nome: string): Promise<EvolutionEstado>;
  encerrar(nome: string): Promise<void>;
  enviarTexto(a: { nome: string; numero: string; texto: string }): Promise<{ externalId: string }>;
  enviarMidia(a: {
    nome: string;
    numero: string;
    tipo: "image" | "video" | "audio" | "document";
    base64OuUrl: string;
    mimetype: string;
    nomeArquivo?: string;
    legenda?: string;
  }): Promise<{ externalId: string }>;
}

export function nomeDaInstancia(channelSessionId: string): string {
  return `dc-${channelSessionId.replace(/-/g, "")}`;
}

export const EVOLUTION_EVENTOS = [
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "CONNECTION_UPDATE",
  "QRCODE_UPDATED",
] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function createEvolutionClient(cfg?: {
  url: string;
  apiKey: string;
  fetch?: typeof fetch;
}): EvolutionClient | null {
  const base = cfg ?? evolutionCredenciais();
  const url = (base?.url ?? "").trim().replace(/\/+$/, "");
  const apiKey = (base?.apiKey ?? "").trim();
  if (!url || !apiKey) return null;
  const doFetch = cfg?.fetch ?? fetch;

  async function chamar(
    metodo: "GET" | "POST" | "DELETE",
    caminho: string,
    corpo?: unknown,
    toleraStatus: number[] = [],
  ): Promise<{ status: number; json: Obj | null }> {
    let res: Response;
    try {
      res = await doFetch(`${url}${caminho}`, {
        method: metodo,
        headers: { apikey: apiKey, "content-type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      // Nao repassa a causa: pode conter a URL/headers com a apikey.
      throw new EvolutionError("indisponivel", `Evolution API inacessivel (${metodo} ${caminho})`);
    }
    if (!res.ok && !toleraStatus.includes(res.status)) {
      const code: EvolutionErrorCode =
        res.status === 404
          ? "nao_encontrado"
          : res.status >= 500 || res.status === 429
            ? "indisponivel"
            : "recusado";
      throw new EvolutionError(code, `Evolution API respondeu ${res.status} (${metodo} ${caminho})`);
    }
    let json: Obj | null = null;
    try {
      json = obj(await res.json());
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  const idEnviado = (json: Obj | null): { externalId: string } => {
    const externalId = str(obj(json?.key)?.id);
    if (!externalId) {
      throw new EvolutionError("indisponivel", "Evolution API nao devolveu o id da mensagem");
    }
    return { externalId };
  };

  return {
    async criarInstancia({ nome, webhookUrl, webhookSecret }) {
      const { json } = await chamar("POST", "/instance/create", {
        instanceName: nome,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
        webhook: {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          headers: { "x-webhook-secret": webhookSecret },
          events: [...EVOLUTION_EVENTOS],
        },
      });
      return { qrBase64: str(obj(json?.qrcode)?.base64) };
    },

    async conectar(nome) {
      const { json } = await chamar("GET", `/instance/connect/${encodeURIComponent(nome)}`);
      return { qrBase64: str(json?.base64), pairingCode: str(json?.pairingCode) };
    },

    async estado(nome) {
      const { status, json } = await chamar(
        "GET",
        `/instance/connectionState/${encodeURIComponent(nome)}`,
        undefined,
        [404],
      );
      if (status === 404) return "inexistente";
      const s = str(obj(json?.instance)?.state);
      return s === "open" || s === "connecting" || s === "close" ? s : "close";
    },

    async encerrar(nome) {
      const n = encodeURIComponent(nome);
      // Qualquer falha do logout (ja desconectado, 5xx, rede) e engolida: o
      // delete SEMPRE roda, para nao deixar instancia orfa no servidor.
      await chamar("DELETE", `/instance/logout/${n}`).catch(() => undefined);
      await chamar("DELETE", `/instance/delete/${n}`, undefined, [404]);
    },

    async enviarTexto({ nome, numero, texto }) {
      const { json } = await chamar("POST", `/message/sendText/${encodeURIComponent(nome)}`, {
        number: numero,
        text: texto,
      });
      return idEnviado(json);
    },

    async enviarMidia({ nome, numero, tipo, base64OuUrl, mimetype, nomeArquivo, legenda }) {
      const n = encodeURIComponent(nome);
      if (tipo === "audio") {
        const { json } = await chamar("POST", `/message/sendWhatsAppAudio/${n}`, {
          number: numero,
          audio: base64OuUrl,
        });
        return idEnviado(json);
      }
      const { json } = await chamar("POST", `/message/sendMedia/${n}`, {
        number: numero,
        mediatype: tipo,
        mimetype,
        media: base64OuUrl,
        ...(nomeArquivo ? { fileName: nomeArquivo } : {}),
        ...(legenda ? { caption: legenda } : {}),
      });
      return idEnviado(json);
    },
  };
}
