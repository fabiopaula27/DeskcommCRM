/**
 * GET  /api/v1/contacts/[id]/notes — anotações do lead, mais recentes primeiro.
 * POST /api/v1/contacts/[id]/notes — nova anotação:
 *   - JSON `{kind:"text", body}`;
 *   - multipart `audio` (+ `duracao`) gravado/enviado na ficha;
 *   - JSON `{kind:"audio", messageId}` — um áudio que o lead mandou no WhatsApp.
 * Áudio é transcrito na hora; sem transcritor a anotação fica salva com
 * `unavailable`, com erro do provedor fica `failed` (dá para tentar de novo).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  BUCKET_DAS_ANOTACOES,
  COLUNAS_DA_ANOTACAO,
  audioDaConversaSchema,
  caminhoDoAudio,
  mimeBase,
  recusaDoAudio,
  tabelaAusente,
  textoSchema,
  type LinhaDaAnotacao,
} from "@/lib/contatos/anotacoes";
import { MARCADOR_NAO_LIDA } from "@/lib/messaging/media/derivable";
import { createAdminClient } from "@/lib/supabase/admin";

import { SEM_TABELA, contextoDasAnotacoes, montarAnotacoes, transcrever, type Ctx, type ContextoDasAnotacoes } from "./_comum";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "viewer");
  if (!c.ok) return c.response;
  const { data, error } = await c.supabase
    .from("contact_notes")
    .select(COLUNAS_DA_ANOTACAO)
    .eq("organization_id", c.orgId)
    .eq("contact_id", c.contatoId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    if (tabelaAusente(error)) return ok({ ...SEM_TABELA, anotacoes: [] }, { requestId });
    return fail("internal_error", "Não consegui ler as anotações.", 500, { requestId });
  }
  return ok({ disponivel: true, anotacoes: await montarAnotacoes((data ?? []) as LinhaDaAnotacao[], c) }, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "agent");
  if (!c.ok) return c.response;

  const tipo = req.headers.get("content-type") ?? "";
  if (tipo.includes("multipart/form-data")) return audioGravado(req, c, requestId);

  const corpo = (await req.json().catch(() => null)) as unknown;
  const texto = textoSchema.safeParse(corpo);
  if (texto.success) {
    return gravar(c, requestId, { kind: "text", body: texto.data.body, transcription_status: "none" });
  }
  const daConversa = audioDaConversaSchema.safeParse(corpo);
  if (daConversa.success) return audioDaConversa(c, requestId, daConversa.data.messageId);
  const msg = texto.error.issues[0]?.message ?? "Dados inválidos.";
  return fail("validation_failed", msg, 400, { requestId });
}

type NovaLinha = {
  id?: string;
  kind: "text" | "audio";
  body: string | null;
  transcription_status: LinhaDaAnotacao["transcription_status"];
  audio_path?: string;
  audio_mime?: string;
  audio_duration_s?: number | null;
  source_message_id?: string;
};

async function gravar(c: ContextoDasAnotacoes, requestId: string, nova: NovaLinha) {
  const { data, error } = await c.supabase
    .from("contact_notes")
    .insert({ ...nova, organization_id: c.orgId, contact_id: c.contatoId, created_by: c.userId })
    .select(COLUNAS_DA_ANOTACAO)
    .single();
  if (error || !data) {
    if (tabelaAusente(error)) return fail("not_available", SEM_TABELA.motivo, 409, { requestId });
    return fail("internal_error", "Não consegui salvar a anotação.", 500, { requestId });
  }
  await audit({
    action: "contact_note.created",
    actorUserId: c.userId,
    organizationId: c.orgId,
    resourceType: "contact_notes",
    resourceId: (data as LinhaDaAnotacao).id,
    requestId,
    metadata: { kind: nova.kind, status: nova.transcription_status, da_conversa: Boolean(nova.source_message_id) },
  });
  const [anotacao] = await montarAnotacoes([data as LinhaDaAnotacao], c);
  return ok({ anotacao }, { requestId, status: 201 });
}

async function audioGravado(req: NextRequest, c: ContextoDasAnotacoes, requestId: string) {
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("audio");
  const file = arquivo instanceof File ? arquivo : null;
  const recusa = recusaDoAudio(file);
  if (recusa || !file) {
    const r = recusa ?? { status: 400, mensagem: "Envie um áudio." };
    return fail("validation_failed", r.mensagem, r.status, { requestId });
  }
  const duracaoBruta = Number(form?.get("duracao"));
  const duracao = Number.isFinite(duracaoBruta) && duracaoBruta > 0 ? Math.round(duracaoBruta) : null;
  const mime = mimeBase(file.type);
  const id = randomUUID();
  const caminho = caminhoDoAudio(c.orgId, c.contatoId, id, mime);
  const buffer = Buffer.from(await file.arrayBuffer());

  const subiu = await createAdminClient().storage.from(BUCKET_DAS_ANOTACOES).upload(caminho, buffer, { contentType: mime });
  if (subiu.error) return fail("internal_error", "Não consegui guardar o áudio.", 500, { requestId });

  const desfecho = await transcrever(c.orgId, buffer, mime);
  return gravar(c, requestId, { id, kind: "audio", audio_path: caminho, audio_mime: mime, audio_duration_s: duracao, ...desfecho });
}

async function audioDaConversa(c: ContextoDasAnotacoes, requestId: string, messageId: string) {
  const admin = createAdminClient();
  const { data: m } = await admin
    .from("messages")
    .select("id, type, media_mime, media_storage_path, media_derived_text, media_derived_status")
    .eq("id", messageId)
    .eq("organization_id", c.orgId)
    .eq("contact_id", c.contatoId)
    .maybeSingle();
  const msg = m as {
    id: string;
    type: string;
    media_mime: string | null;
    media_storage_path: string | null;
    media_derived_text: string | null;
    media_derived_status: string | null;
  } | null;
  if (!msg || msg.type !== "audio") return fail("not_found", "Áudio não encontrado nesta conversa.", 404, { requestId });
  if (!msg.media_storage_path) return fail("gone", "O arquivo deste áudio não está mais disponível.", 410, { requestId });

  const baixou = await admin.storage.from("whatsapp-media").download(msg.media_storage_path);
  if (baixou.error || !baixou.data) return fail("gone", "O arquivo deste áudio não está mais disponível.", 410, { requestId });
  const buffer = Buffer.from(await baixou.data.arrayBuffer());
  const mime = mimeBase(msg.media_mime ?? "audio/ogg");
  const id = randomUUID();
  const caminho = caminhoDoAudio(c.orgId, c.contatoId, id, mime);
  const subiu = await admin.storage.from(BUCKET_DAS_ANOTACOES).upload(caminho, buffer, { contentType: mime });
  if (subiu.error) return fail("internal_error", "Não consegui guardar o áudio.", 500, { requestId });

  const jaTranscrito = (msg.media_derived_text ?? "").trim();
  const pronto = msg.media_derived_status === "ready" && jaTranscrito !== "" && jaTranscrito !== MARCADOR_NAO_LIDA;
  const desfecho = pronto
    ? { transcription_status: "ready" as const, body: jaTranscrito }
    : await transcrever(c.orgId, buffer, mime);
  return gravar(c, requestId, {
    id,
    kind: "audio",
    audio_path: caminho,
    audio_mime: mime,
    source_message_id: msg.id,
    ...desfecho,
  });
}
