/**
 * Ciclo de conexão do canal Evolution API (WhatsApp por QR/Baileys):
 * conectar, QR, reconectar, desconectar e o efeito dos eventos de conexão.
 *
 * ─── Por que NÃO passa por `fn_reserve_channel_connection` ──────────────────
 *
 * A reserva do WAHA insere a linha com colunas do WAHA chumbadas
 * (`waha_session_name`, `engine = 'NOWEB'`) e o provider default; reusá-la
 * exigiria migration nova. Aqui a linha entra por INSERT direto pelo service
 * client — o mesmo caminho de `savePartnerSession` (`./connect.ts`) — e o teto
 * do plano continua valendo porque quem recusa é o gatilho
 * `fn_trava_canais_do_plano` (BEFORE INSERT em `channel_sessions`), que vale
 * para qualquer INSERT. A recusa sobe CRUA para a rota traduzir em 409.
 * Papel, suporte e MFA são conferidos pela rota antes de chegar aqui.
 *
 * Idempotência: a chave mora em `metadata.evolution_idempotency_key`; a mesma
 * chave devolve a mesma linha e não cria segunda instância.
 *
 * ─── Vocabulário de status ───────────────────────────────────────────────────
 *
 * O de `channel_sessions`: STARTING (conectando, sem QR ainda), SCAN_QR_CODE
 * (QR na tela), WORKING (pareado), STOPPED (fechou), FAILED (com
 * `status_reason`). `last_status_change_at` é o "conectado desde" lido pelo
 * filtro de histórico do ingest quando o status é WORKING — por isso só muda
 * numa TRANSIÇÃO real para WORKING, nunca num `open` repetido.
 */
import { randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { audit } from "@/lib/audit";
import { lerLimiteEstourado } from "@/lib/cobranca/limites";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { decryptWebhookSecret, encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { CHANNEL_PROVIDER_EVOLUTION } from "./capabilities";
import { type EvolutionClient, nomeDaInstancia } from "./evolution/client";
import type { EvolutionEvento } from "./evolution/webhook";
import { canonicalPhoneBR, phoneLookupVariants } from "./phone-variants";

export class EvolutionConnectionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "EvolutionConnectionError";
  }
}

/** A rota pergunta isto em vez de escrever o nome do provider. */
export function canalEvolution(session: { provider: string | null | undefined }): boolean {
  return session.provider === CHANNEL_PROVIDER_EVOLUTION;
}

export const MOTIVO_NUMERO_EM_USO = "numero_em_uso";
const IDEMPOTENCY_META = "evolution_idempotency_key";

function naoConfigurado(): EvolutionConnectionError {
  return new EvolutionConnectionError("evolution_nao_configurado", 503);
}

function urlDoWebhook(token: string): string {
  const base = (env.EVOLUTION_WEBHOOK_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) throw naoConfigurado();
  return `${base}/api/v1/webhooks/channel/${token}`;
}

const agora = () => new Date().toISOString();

async function marcar(
  db: SupabaseClient,
  organizationId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.from("channel_sessions").update(patch).eq("organization_id", organizationId).eq("id", id);
}

async function buscarPorChave(db: SupabaseClient, org: string, chave: string): Promise<string | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", org)
    .eq("provider", CHANNEL_PROVIDER_EVOLUTION)
    .eq(`metadata->>${IDEMPOTENCY_META}`, chave)
    .maybeSingle();
  if (error) throw new EvolutionConnectionError("connection_reservation_failed", 503);
  return (data as { id: string } | null)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Conectar
// ---------------------------------------------------------------------------

export async function conectarEvolution(
  authDb: SupabaseClient,
  serviceDb: SupabaseClient,
  client: EvolutionClient | null,
  input: { organizationId: string; userId: string; displayName?: string; idempotencyKey: string },
): Promise<{ channelSessionId: string; qrBase64: string | null }> {
  if (!z.string().uuid().safeParse(input.idempotencyKey).success) {
    throw new EvolutionConnectionError("idempotency_key_required", 422);
  }
  if (!client) throw naoConfigurado();

  const existente = await buscarPorChave(authDb, input.organizationId, input.idempotencyKey);
  if (existente) return { channelSessionId: existente, qrBase64: null };

  const id = randomUUID();
  const nome = nomeDaInstancia(id);
  const token = randomBytes(16).toString("hex");
  const segredo = randomBytes(32).toString("hex");
  const webhookUrl = urlDoWebhook(token);
  const segredoCifrado = await encryptWebhookSecret(serviceDb, segredo);
  if (!segredoCifrado) throw new EvolutionConnectionError("cifra_indisponivel", 503);

  const { error } = await serviceDb.from("channel_sessions").insert({
    id,
    organization_id: input.organizationId,
    provider: CHANNEL_PROVIDER_EVOLUTION,
    evolution_instance_name: nome,
    webhook_path_token: token,
    webhook_secret_encrypted: segredoCifrado,
    display_name: input.displayName ?? null,
    status: "STARTING",
    status_reason: "connection_pending",
    last_status_change_at: agora(),
    metadata: { ...metadataInicialDoCanal(), [IDEMPOTENCY_META]: input.idempotencyKey },
  });
  if (error) {
    // O gatilho do teto do plano recusa de dentro do INSERT: sobe cru.
    if (lerLimiteEstourado(error)) throw error;
    // 23505 no índice de idempotência: outra requisição com a mesma chave
    // ganhou a corrida. Replay da linha dela, sem segunda instância.
    if (error.code === "23505") {
      const vencedora = await buscarPorChave(serviceDb, input.organizationId, input.idempotencyKey);
      if (vencedora) return { channelSessionId: vencedora, qrBase64: null };
    }
    throw new EvolutionConnectionError("connection_reservation_failed", 500);
  }

  let qrBase64: string | null;
  try {
    ({ qrBase64 } = await client.criarInstancia({ nome, webhookUrl, webhookSecret: segredo }));
  } catch {
    await marcar(serviceDb, input.organizationId, id, {
      status: "FAILED",
      status_reason: "connection_repair_required",
      last_status_change_at: agora(),
    });
    throw new EvolutionConnectionError("connection_repair_required", 502);
  }
  await marcar(serviceDb, input.organizationId, id, {
    status: qrBase64 ? "SCAN_QR_CODE" : "STARTING",
    status_reason: null,
    last_status_change_at: agora(),
  });
  void audit({
    action: "channel.connected",
    actorUserId: input.userId,
    organizationId: input.organizationId,
    resourceType: "channel_session",
    resourceId: id,
    metadata: { provider: CHANNEL_PROVIDER_EVOLUTION, origin: "connections" },
  });
  return { channelSessionId: id, qrBase64 };
}

// ---------------------------------------------------------------------------
// QR e reconectar
// ---------------------------------------------------------------------------

interface SessaoEvolution {
  id: string;
  evolution_instance_name: string;
  webhook_path_token: string | null;
  webhook_secret_encrypted: string | null;
}

async function sessaoAtiva(db: SupabaseClient, orgId: string, id: string): Promise<SessaoEvolution> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, provider, evolution_instance_name, webhook_path_token, webhook_secret_encrypted, archived_at")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new EvolutionConnectionError("connection_status_failed", 503);
  const row = data as (SessaoEvolution & { provider: string; archived_at: string | null }) | null;
  if (!row) throw new EvolutionConnectionError("not_found", 404);
  // Escanear o QR RELIGA o número: canal excluído não pode voltar por aqui.
  if (row.archived_at) throw new EvolutionConnectionError("channel_archived", 409);
  if (!canalEvolution(row) || !row.evolution_instance_name) {
    throw new EvolutionConnectionError("channel_not_qr", 409);
  }
  return row;
}

export async function qrDaEvolution(
  db: SupabaseClient,
  orgId: string,
  id: string,
  client: EvolutionClient | null,
): Promise<{ qrBase64: string | null; pairingCode: string | null }> {
  const s = await sessaoAtiva(db, orgId, id);
  if (!client) throw naoConfigurado();
  try {
    return await client.conectar(s.evolution_instance_name);
  } catch {
    throw new EvolutionConnectionError("evolution_indisponivel", 502);
  }
}

/** Reusa nome, token e segredo; recria a instância só se ela sumiu do servidor. */
export async function reconectarEvolution(
  db: SupabaseClient,
  orgId: string,
  id: string,
  client: EvolutionClient | null,
): Promise<{ qrBase64: string | null }> {
  const s = await sessaoAtiva(db, orgId, id);
  if (!client) throw naoConfigurado();
  let qrBase64: string | null;
  try {
    if ((await client.estado(s.evolution_instance_name)) === "inexistente") {
      const segredo = s.webhook_secret_encrypted
        ? await decryptWebhookSecret(db, s.webhook_secret_encrypted)
        : null;
      if (!s.webhook_path_token || !segredo || segredo.length < 16) {
        throw new EvolutionConnectionError("connection_repair_required", 409);
      }
      ({ qrBase64 } = await client.criarInstancia({
        nome: s.evolution_instance_name,
        webhookUrl: urlDoWebhook(s.webhook_path_token),
        webhookSecret: segredo,
      }));
    } else {
      ({ qrBase64 } = await client.conectar(s.evolution_instance_name));
    }
  } catch (e) {
    if (e instanceof EvolutionConnectionError) throw e;
    await marcar(db, orgId, id, {
      status: "FAILED",
      status_reason: "connection_repair_required",
      last_status_change_at: agora(),
    });
    throw new EvolutionConnectionError("evolution_indisponivel", 502);
  }
  await marcar(db, orgId, id, {
    status: qrBase64 ? "SCAN_QR_CODE" : "STARTING",
    status_reason: null,
    last_status_change_at: agora(),
  });
  return { qrBase64 };
}

// ---------------------------------------------------------------------------
// Desconectar
// ---------------------------------------------------------------------------

/**
 * Encerra a instância no servidor. Lança se a Evolution falhar — a rota de
 * exclusão então NÃO arquiva (arquivar com a instância viva deixaria o número
 * pareado e surdo).
 */
export async function desconectarEvolution(
  client: EvolutionClient | null,
  session: { evolution_instance_name?: string | null },
): Promise<void> {
  if (!client) throw naoConfigurado();
  if (!session.evolution_instance_name) return;
  try {
    await client.encerrar(session.evolution_instance_name);
  } catch {
    throw new EvolutionConnectionError("evolution_indisponivel", 502);
  }
}

// ---------------------------------------------------------------------------
// Eventos de conexão (webhook)
// ---------------------------------------------------------------------------

type EventoDeConexao = Extract<EvolutionEvento, { tipo: "conexao" | "qr" }>;

export async function atualizarConexaoEvolution(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    channelSessionId: string;
    evento: EventoDeConexao;
    client: EvolutionClient | null;
  },
): Promise<{ status: string; motivo: string | null }> {
  const { organizationId: org, channelSessionId: id, evento } = input;
  const transicao = async (status: string, guardas: string[]) => {
    let q = admin
      .from("channel_sessions")
      .update({ status, status_reason: null, last_status_change_at: agora() })
      .eq("organization_id", org)
      .eq("id", id);
    for (const g of guardas) q = q.neq("status", g);
    await q;
    return { status, motivo: null };
  };

  if (evento.tipo === "qr") return transicao("SCAN_QR_CODE", ["SCAN_QR_CODE", "WORKING"]);
  if (evento.estado === "connecting") return transicao("STARTING", ["STARTING", "SCAN_QR_CODE", "WORKING"]);
  // FAILED tem motivo (ex.: numero_em_uso); o `close` que segue o encerrar não o apaga.
  if (evento.estado === "close") return transicao("STOPPED", ["STOPPED", "FAILED"]);

  // open
  const { data: atual } = await admin
    .from("channel_sessions")
    .select("status, phone_number, evolution_instance_name")
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  const linha = atual as { status: string; phone_number: string | null; evolution_instance_name: string | null } | null;
  if (!linha) return { status: "ignored", motivo: "sessao_inexistente" };

  // Mesmo formato do WAHA (`numeroObservadoDaSessao`): só dígitos, sem `+` —
  // é o que faz a trava por org (0106) enxergar o mesmo número nos dois.
  const telefone = evento.telefone ? canonicalPhoneBR(`+${evento.telefone}`).replace(/^\+/, "") : null;
  // Com e sem `+`: linhas legadas de canais por credencial gravam E.164.
  const formas = telefone ? phoneLookupVariants(telefone).flatMap((v) => [v, v.slice(1)]) : [];
  if (telefone) {
    const { data: outros } = await admin
      .from("channel_sessions")
      .select("id")
      .in("phone_number", formas)
      .is("archived_at", null)
      .neq("id", id)
      // Só canal VIVO disputa o número: um FAILED/STOPPED antigo não pode
      // travar a reconexão do mesmo telefone para sempre.
      .in("status", ["WORKING", "STARTING", "SCAN_QR_CODE"])
      .limit(1);
    if ((outros ?? []).length > 0) return numeroEmUso(admin, input, linha.evolution_instance_name);
  }

  if (linha.status !== "WORKING") {
    const { error } = await admin
      .from("channel_sessions")
      .update({
        status: "WORKING",
        status_reason: null,
        last_status_change_at: agora(),
        ...(telefone ? { phone_number: telefone } : {}),
      })
      .eq("organization_id", org)
      .eq("id", id)
      .neq("status", "WORKING");
    // 23505 = trava de número único por organização (0106).
    if (error?.code === "23505") return numeroEmUso(admin, input, linha.evolution_instance_name);
  } else if (telefone && telefone !== linha.phone_number) {
    const { error } = await admin
      .from("channel_sessions")
      .update({ phone_number: telefone })
      .eq("organization_id", org)
      .eq("id", id);
    if (error?.code === "23505") return numeroEmUso(admin, input, linha.evolution_instance_name);
  }
  if (telefone && (await perdeuACorrida(admin, id, formas))) {
    return numeroEmUso(admin, input, linha.evolution_instance_name);
  }
  return { status: "WORKING", motivo: null };
}

/**
 * Dois `open` simultâneos do mesmo número (orgs diferentes) passam ambos pela
 * checagem prévia. Depois de gravar, confere de novo: fica quem conectou
 * PRIMEIRO (`last_status_change_at` menor; empate → menor id). Quem perdeu se
 * derruba — nunca a outra.
 */
async function perdeuACorrida(admin: SupabaseClient, id: string, formas: string[]): Promise<boolean> {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, last_status_change_at")
    .in("phone_number", formas)
    .is("archived_at", null)
    .eq("status", "WORKING");
  const linhas = (data ?? []) as Array<{ id: string; last_status_change_at: string | null }>;
  const eu = linhas.find((l) => l.id === id);
  if (!eu) return false;
  const t = (l: { last_status_change_at: string | null }) =>
    l.last_status_change_at ? new Date(l.last_status_change_at).getTime() : Number.POSITIVE_INFINITY;
  return linhas.some((o) => o.id !== id && (t(o) < t(eu) || (t(o) === t(eu) && o.id < id)));
}

/** O número já atende em outro canal ativo: derruba ESTA instância, nunca a outra. */
async function numeroEmUso(
  admin: SupabaseClient,
  input: { organizationId: string; channelSessionId: string; client: EvolutionClient | null },
  nome: string | null,
): Promise<{ status: string; motivo: string }> {
  if (nome && input.client) {
    try {
      await input.client.encerrar(nome);
    } catch (e) {
      logger.warn("[evolution] encerrar após numero_em_uso falhou", {
        channel_session_id: input.channelSessionId,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
  await marcar(admin, input.organizationId, input.channelSessionId, {
    status: "FAILED",
    status_reason: MOTIVO_NUMERO_EM_USO,
    last_status_change_at: agora(),
  });
  return { status: "FAILED", motivo: MOTIVO_NUMERO_EM_USO };
}
