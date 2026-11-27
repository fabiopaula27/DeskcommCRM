/**
 * PATCH  /api/v1/contacts/[id]/notes/[noteId] — corrige o texto (ou a transcrição).
 * DELETE /api/v1/contacts/[id]/notes/[noteId] — apaga a anotação e o áudio.
 * Autor mexe na própria; manager+ em qualquer uma (a RLS repete a regra).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { BUCKET_DAS_ANOTACOES, COLUNAS_DA_ANOTACAO, edicaoSchema, podeMexer, type LinhaDaAnotacao } from "@/lib/contatos/anotacoes";
import { createAdminClient } from "@/lib/supabase/admin";

import { contextoDasAnotacoes, lerAnotacao, montarAnotacoes, type Ctx } from "../_comum";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "agent");
  if (!c.ok) return c.response;
  const { noteId } = await ctx.params;
  const linha = await lerAnotacao(c.supabase, c, noteId ?? "");
  if (!linha) return fail("not_found", "Anotação não encontrada.", 404, { requestId });
  if (!podeMexer(linha, c.userId, c.ehGerente)) {
    return fail("forbidden", "Só quem escreveu (ou um gerente) pode mudar esta anotação.", 403, { requestId });
  }
  const v = edicaoSchema.safeParse(await req.json().catch(() => null));
  if (!v.success) return fail("validation_failed", v.error.issues[0]?.message ?? "Dados inválidos.", 400, { requestId });

  const { data, error } = await c.supabase
    .from("contact_notes")
    .update({ body: v.data.body, ...(linha.kind === "audio" ? { transcription_status: "ready" } : {}) })
    .eq("id", linha.id)
    .eq("organization_id", c.orgId)
    .select(COLUNAS_DA_ANOTACAO)
    .single();
  if (error || !data) return fail("internal_error", "Não consegui salvar a anotação.", 500, { requestId });
  await audit({
    action: "contact_note.updated",
    actorUserId: c.userId,
    organizationId: c.orgId,
    resourceType: "contact_notes",
    resourceId: linha.id,
    requestId,
    metadata: { kind: linha.kind },
  });
  const [anotacao] = await montarAnotacoes([data as LinhaDaAnotacao], c);
  return ok({ anotacao }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "agent");
  if (!c.ok) return c.response;
  const { noteId } = await ctx.params;
  const linha = await lerAnotacao(c.supabase, c, noteId ?? "");
  if (!linha) return fail("not_found", "Anotação não encontrada.", 404, { requestId });
  if (!podeMexer(linha, c.userId, c.ehGerente)) {
    return fail("forbidden", "Só quem escreveu (ou um gerente) pode apagar esta anotação.", 403, { requestId });
  }
  const { error } = await c.supabase.from("contact_notes").delete().eq("id", linha.id).eq("organization_id", c.orgId);
  if (error) return fail("internal_error", "Não consegui apagar a anotação.", 500, { requestId });
  if (linha.audio_path) await createAdminClient().storage.from(BUCKET_DAS_ANOTACOES).remove([linha.audio_path]);
  await audit({
    action: "contact_note.deleted",
    actorUserId: c.userId,
    organizationId: c.orgId,
    resourceType: "contact_notes",
    resourceId: linha.id,
    requestId,
    metadata: { kind: linha.kind },
  });
  return ok({ apagada: true }, { requestId });
}
