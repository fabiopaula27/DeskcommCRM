/**
 * POST /api/v1/contacts/[id]/notes/[noteId]/transcrever — tenta de novo a
 * transcrição de um áudio que ficou `failed` ou `unavailable`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { BUCKET_DAS_ANOTACOES, audioDoContato, COLUNAS_DA_ANOTACAO, podeMexer, type LinhaDaAnotacao } from "@/lib/contatos/anotacoes";
import { createAdminClient } from "@/lib/supabase/admin";

import { contextoDasAnotacoes, lerAnotacao, montarAnotacoes, transcrever, type Ctx } from "../../_comum";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "agent");
  if (!c.ok) return c.response;
  const { noteId } = await ctx.params;
  const linha = await lerAnotacao(c.supabase, c, noteId ?? "");
  if (!linha || linha.kind !== "audio" || !linha.audio_path || !audioDoContato(linha.audio_path, c.orgId, c.contatoId)) {
    return fail("not_found", "Anotação de áudio não encontrada.", 404, { requestId });
  }
  if (!podeMexer(linha, c.userId, c.ehGerente)) {
    return fail("forbidden", "Só quem gravou (ou um gerente) pode refazer a transcrição.", 403, { requestId });
  }
  if (linha.transcription_status === "ready") {
    const [anotacao] = await montarAnotacoes([linha], c);
    return ok({ anotacao }, { requestId });
  }
  const { data: reservou } = await c.supabase
    .from("contact_notes")
    .update({ transcription_status: "pending" })
    .eq("id", linha.id)
    .eq("organization_id", c.orgId)
    .neq("transcription_status", "pending")
    .select("id")
    .maybeSingle();
  if (!reservou) return fail("conflict", "Esta transcrição já está em andamento.", 409, { requestId });
  const baixou = await createAdminClient().storage.from(BUCKET_DAS_ANOTACOES).download(linha.audio_path);
  if (baixou.error || !baixou.data) {
    await c.supabase.from("contact_notes").update({ transcription_status: "failed" }).eq("id", linha.id).eq("organization_id", c.orgId);
    return fail("gone", "O arquivo deste áudio não está mais disponível.", 410, { requestId });
  }
  const desfecho = await transcrever(c.orgId, Buffer.from(await baixou.data.arrayBuffer()), linha.audio_mime ?? "audio/webm");

  const { data, error } = await c.supabase
    .from("contact_notes")
    .update(desfecho)
    .eq("id", linha.id)
    .eq("organization_id", c.orgId)
    .select(COLUNAS_DA_ANOTACAO)
    .single();
  if (error || !data) return fail("internal_error", "Não consegui salvar a transcrição.", 500, { requestId });
  const [anotacao] = await montarAnotacoes([data as LinhaDaAnotacao], c);
  return ok({ anotacao }, { requestId });
}
