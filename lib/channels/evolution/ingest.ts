/**
 * Ingestão do canal Evolution API: evento já lido e autenticado → banco.
 *
 * A leitura do fio é de `./webhook.ts`; aqui moram os EFEITOS, na mesma ordem
 * de `zernio/ingest.ts`: aviso interno → contato → conversa → mensagem →
 * carimbo → efeitos de entrada. A organização e a sessão vêm do TOKEN do path
 * (resolvido pela rota) e já foram conferidas contra `body.instance` em
 * `inbound.ts`; este módulo não descobre de quem é o evento, só grava.
 *
 * ─── Histórico ───────────────────────────────────────────────────────────────
 *
 * Ao parear, o Baileys despeja o histórico do aparelho como `messages.upsert`.
 * Ingerir isso acordaria o agente para conversas de meses atrás. Só entra o que
 * foi escrito DEPOIS da conexão; sem timestamp ou sem `connectedAt` não há como
 * provar que é fresca, e perder uma mensagem sem hora é melhor que uma enxurrada.
 *
 * ─── Mídia ───────────────────────────────────────────────────────────────────
 *
 * A Evolution entrega os bytes em base64 no próprio webhook (não há URL para o
 * worker baixar depois), então o upload é feito aqui, no MESMO bucket e caminho
 * do `workers/media-persist-worker.ts`, e a derivação é pedida pelo mesmo evento
 * que o worker emite.
 */
import { timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ehEcoDeEnvioEmVoo } from "@/lib/channels/eco-de-envio";
import { encontrarContatoPorTelefone } from "@/lib/channels/contato-por-telefone";
import { sincronizarSaudeDaConexao } from "@/lib/channels/health";
import { marcarConversaComMensagem } from "@/lib/channels/marcar-conversa";
import { canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { pausarIaPorAtendimentoManual } from "@/lib/escalacao/atendimento-manual";
import { consumirRespostaDoSuporteNoWhatsApp } from "@/lib/escalacao/resposta-whatsapp-ao-caso";
import { logger } from "@/lib/logger";
import { MAX_MEDIA_BYTES, storagePathFor } from "@/lib/messaging/media/types";

import { atualizarConexaoEvolution } from "../connect-evolution";

import { createEvolutionClient } from "./client";
import { evolutionConfigurado } from "./credentials";
import type { EvolutionEvento } from "./webhook";

export const HEADER_SEGREDO_EVOLUTION = "x-deskcomm-webhook-secret";
const MIN_SECRET_LEN = 16;
const BUCKET = "whatsapp-media";

export type EvolutionIngestResult = { status: "ingested" | "ignored"; reason: string };

type Mensagem = Extract<EvolutionEvento, { tipo: "mensagem" }>;

/** Header = segredo da sessão, em tempo constante. Segredo curto = recusa. */
export function verifyEvolutionSecret(headers: Headers, secret: string | null): boolean {
  if (!secret || secret.length < MIN_SECRET_LEN) return false;
  const recebido = headers.get(HEADER_SEGREDO_EVOLUTION);
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function ingestEvolutionEvento(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    connectedAt: Date | null;
    evento: EvolutionEvento;
    /** Apelido da conexão, para o título do aviso de saúde. */
    apelido?: string;
  },
): Promise<EvolutionIngestResult> {
  const { evento } = input;
  switch (evento.tipo) {
    case "ignorado":
      return { status: "ignored", reason: evento.motivo };
    case "status":
      return aplicarStatus(admin, input, evento);
    case "conexao":
    case "qr": {
      // Efeito na linha (status, telefone, numero_em_uso) e depois o vigia.
      const r = await atualizarConexaoEvolution(admin, {
        organizationId: input.organizationId,
        channelSessionId: input.channelSessionId,
        evento,
        client: evolutionConfigurado() ? createEvolutionClient() : null,
      });
      const status = r.status === "ignored" ? "STOPPED" : r.status;
      await sincronizarSaudeDaConexao(
        admin,
        { id: input.channelSessionId, organization_id: input.organizationId, status },
        { reachable: true, status, detail: r.motivo },
        input.apelido ?? "sem nome",
        "empurrao",
      );
      return { status: "ingested", reason: r.motivo ?? `conexao_${status.toLowerCase()}` };
    }
    case "mensagem":
      return ingerirMensagem(admin, input, evento);
  }
}

async function aplicarStatus(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string },
  evento: Extract<EvolutionEvento, { tipo: "status" }>,
): Promise<EvolutionIngestResult> {
  const { data } = await admin
    .from("messages")
    .update({ status: evento.status })
    .eq("organization_id", input.organizationId)
    .eq("channel_session_id", input.channelSessionId)
    .eq("external_id", evento.externalId)
    // Não rebaixa: a ordem de entrega do webhook não é garantida.
    // `failed` também é terminal: um `delivered` atrasado não o apaga.
    .not("status", "in", "(read,failed)")
    .select("id");
  return (data ?? []).length > 0
    ? { status: "ingested", reason: `status_${evento.status}` }
    : { status: "ignored", reason: "mensagem_desconhecida" };
}

async function ingerirMensagem(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; connectedAt: Date | null },
  msg: Mensagem,
): Promise<EvolutionIngestResult> {
  if (!input.connectedAt || !msg.timestamp || msg.timestamp < input.connectedAt) {
    return { status: "ignored", reason: "historico" };
  }

  const direction = msg.fromMe ? "outbound" : "inbound";
  const telefone = msg.de.telefone ? canonicalPhoneBR(`+${msg.de.telefone}`) : null;
  const lid = msg.de.lid ? msg.de.lid.replace(/@lid$/, "") : null;

  if (
    await consumirRespostaDoSuporteNoWhatsApp(admin, {
      organizationId: input.organizationId,
      channelSessionId: input.channelSessionId,
      identidade: { kind: lid ? "lid" : telefone ? "phone" : "unknown", phone: telefone, lid },
      direction,
      texto: msg.texto,
      externalId: msg.externalId,
    })
  ) {
    return { status: "ignored", reason: "numero_interno_de_aviso" };
  }

  if (!lid && !telefone) return { status: "ignored", reason: "sem_identidade_utilizavel" };

  // Mesma regra do WAHA: chat `@lid` ancora no lid e leva o telefone
  // alternativo junto; senão, âncora telefone.
  const existente = telefone
    ? await encontrarContatoPorTelefone(admin, input.organizationId, telefone)
    : null;
  const phone = existente?.phone_number ? canonicalPhoneBR(existente.phone_number) : telefone;
  const { data: contato, error: erroContato } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: input.organizationId,
    p_kind: lid ? "lid" : "phone",
    p_phone: phone,
    p_lid: lid,
    p_chat_id: msg.de.lid ?? `${msg.de.telefone}@s.whatsapp.net`,
    p_notify: msg.fromMe ? null : msg.de.nome,
  } as never);
  const contactId = erroContato ? null : ((contato as string | null) ?? null);
  if (!contactId) return { status: "ignored", reason: "contato_nao_resolvido" };

  const { data: conversa, error: erroConversa } = await admin.rpc(
    "fn_upsert_wa_conversation" as never,
    { p_org: input.organizationId, p_contact: contactId, p_session: input.channelSessionId } as never,
  );
  const conversationId = erroConversa ? null : ((conversa as string | null) ?? null);
  if (!conversationId) return { status: "ignored", reason: "conversa_nao_resolvida" };

  // O Baileys pode entregar o `fromMe` do NOSSO envio antes de a resposta HTTP
  // do envio devolver o id: a linha ainda está `sending` sem `external_id`, o
  // 23505 não pega, e o eco viraria bolha duplicada + IA pausada por 3 h. Mesma
  // guarda do WAHA. A linha em voo recebe o id pelo próprio envio.
  if (
    direction === "outbound" &&
    (await ehEcoDeEnvioEmVoo(admin, {
      organizationId: input.organizationId,
      conversationId,
      corpo: msg.texto,
      ehMidia: Boolean(msg.midia),
      tag: "evolution.ingest",
    }))
  ) {
    return { status: "ignored", reason: "eco_de_envio_em_voo" };
  }

  const sentAt = msg.timestamp.toISOString();
  const { data: linha, error } = await admin
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversationId,
      contact_id: contactId,
      channel_session_id: input.channelSessionId,
      external_id: msg.externalId,
      direction,
      // Veio do webhook, não do composer: o eco do envio do próprio CRM já
      // existe com o mesmo external_id e cai no 23505 abaixo.
      sent_via: "external_device",
      status: direction === "outbound" ? "sent" : "delivered",
      type: msg.midia?.tipo ?? "text",
      body: msg.texto,
      ...(msg.midia ? { media_mime: msg.midia.mimetype } : {}),
      metadata: msg.midia?.nomeArquivo ? { file_name: msg.midia.nomeArquivo } : {},
      sent_at: sentAt,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") return { status: "ignored", reason: "duplicada" };
  if (error || !linha) throw new Error(`evolution_ingest_insert_failed: ${error?.message ?? "sem id"}`);
  const messageId = (linha as { id: string }).id;

  await marcarConversaComMensagem(admin, {
    organizationId: input.organizationId,
    conversationId,
    direction,
    preview: (msg.texto ?? "").slice(0, 200),
    at: sentAt,
    canal: "evolution",
  });

  if (msg.midia) {
    await persistirMidia(admin, input.organizationId, conversationId, messageId, msg.midia);
  }

  if (direction === "inbound") {
    await aplicarEfeitosPosEntrada(admin, {
      organizationId: input.organizationId,
      contactId,
      conversationId,
      messageId,
      channelSessionId: input.channelSessionId,
      texto: msg.texto,
      nomeDoContato: msg.de.nome,
      origem: "evolution_webhook",
    });
  } else {
    // Saída feita pelo celular: alguém respondeu à mão, a IA para.
    await pausarIaPorAtendimentoManual(admin, {
      organizationId: input.organizationId,
      conversationId,
      canal: "evolution",
    });
  }

  return { status: "ingested", reason: direction };
}

/**
 * Bytes base64 → Storage, no caminho de `storagePathFor`, e a linha marcada como
 * o worker marcaria. Best-effort: a mensagem já está visível, e derrubar a
 * ingestão faria a Evolution reentregar tudo.
 */
async function persistirMidia(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  messageId: string,
  midia: NonNullable<Mensagem["midia"]>,
): Promise<void> {
  // Merge com o metadata gravado no insert: o patch não pode apagar o que já
  // estava lá (nome do arquivo, ou o que outro passo carimbou).
  const marcar = async (patch: Record<string, unknown>, meta: Record<string, unknown>) => {
    const { data } = await admin
      .from("messages")
      .select("metadata")
      .eq("organization_id", organizationId)
      .eq("id", messageId)
      .maybeSingle();
    const atual = ((data as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<string, unknown>;
    await admin
      .from("messages")
      .update({ ...patch, metadata: { ...atual, ...meta } })
      .eq("organization_id", organizationId)
      .eq("id", messageId);
  };
  const falhar = (motivo: string) =>
    marcar({ media_derived_status: "skipped" }, { media_status: "failed", media_derived_motivo: motivo });

  if (!midia.base64) {
    await falhar("a Evolution não enviou os bytes (webhook sem base64)");
    return;
  }
  // Mesmo teto do caminho do WAHA (`waha-source.ts`), conferido pelo tamanho
  // DECLARADO antes de decodificar — não aloca o que vai recusar.
  const estimado = Math.floor((midia.base64.length * 3) / 4);
  if (estimado > MAX_MEDIA_BYTES + 2) {
    await falhar(`mídia acima do limite de ${MAX_MEDIA_BYTES} bytes`);
    return;
  }
  const buffer = Buffer.from(midia.base64, "base64");
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    await falhar(`mídia acima do limite de ${MAX_MEDIA_BYTES} bytes`);
    return;
  }

  const path = storagePathFor(organizationId, conversationId, messageId, midia.mimetype);
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: midia.mimetype, upsert: true });
  if (error) {
    logger.warn("[evolution] upload da mídia falhou", { messageId, detail: error.message });
    await falhar(`não consegui salvar a mídia no Storage: ${error.message}`);
    return;
  }
  await marcar(
    { media_storage_path: path, media_size_bytes: buffer.byteLength, media_mime: midia.mimetype },
    { media_status: "stored" },
  );

  const { error: emitErr } = await admin.rpc("emit_event" as never, {
    p_event_type: "media.derive_requested",
    p_entity_kind: "message",
    p_entity_id: messageId,
    p_payload: { message_id: messageId },
    p_metadata: { source: "evolution_webhook" },
    p_organization_id: organizationId,
  } as never);
  if (emitErr) {
    logger.warn("[evolution] emit media.derive_requested falhou", { messageId, detail: emitErr.message });
  }
}
