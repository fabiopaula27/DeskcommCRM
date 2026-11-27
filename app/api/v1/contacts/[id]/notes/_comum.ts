/**
 * O que as rotas de anotações do lead têm em comum: papel, org da sessão,
 * contato da MESMA org (senão 404), transcrição e URL assinada do áudio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast, type Role } from "@/lib/auth/types";
import {
  BUCKET_DAS_ANOTACOES,
  COLUNAS_DA_ANOTACAO,
  audioDoContato,
  desfechoDaTranscricao,
  paraAnotacao,
  type Anotacao,
  type LinhaDaAnotacao,
  type StatusDaTranscricao,
} from "@/lib/contatos/anotacoes";
import { depsReaisDoTranscritor, transcritorDaOrganizacao } from "@/lib/messaging/media/transcritor-da-organizacao";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export type Ctx = { params: Promise<{ id: string; noteId?: string }> };

export type ContextoDasAnotacoes = {
  ok: true;
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  ehGerente: boolean;
  contatoId: string;
};

export async function contextoDasAnotacoes(
  ctx: Ctx,
  requestId: string,
  papel: Role,
): Promise<ContextoDasAnotacoes | { ok: false; response: Response }> {
  const authz = await requireRole(papel, { requestId, resource: "contacts" });
  if (!authz.ok) return { ok: false, response: authz.response };
  const { id } = await ctx.params;
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: contato } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!contato) return { ok: false, response: fail("not_found", "Contato não encontrado.", 404, { requestId }) };
  return {
    ok: true,
    supabase,
    orgId: authz.org.orgId,
    userId: authz.user.id,
    ehGerente: roleAtLeast(authz.org.role, "manager"),
    contatoId: id,
  };
}

export const SEM_TABELA = { disponivel: false, motivo: "Rode a migration 9115 (anotações do lead) no banco." };

/** Transcreve com a escada da organização. Nunca lança. */
export async function transcrever(
  orgId: string,
  audio: Buffer,
  mime: string,
): Promise<{ transcription_status: StatusDaTranscricao; body: string | null }> {
  const { transcriber, motivo } = await transcritorDaOrganizacao(orgId, await depsReaisDoTranscritor());
  if (!transcriber) {
    logger.info("[anotacoes] sem transcritor", { organization_id: orgId, motivo });
    return desfechoDaTranscricao({ tipo: "sem_transcritor" });
  }
  try {
    return desfechoDaTranscricao({ tipo: "texto", texto: await transcriber.transcribe(audio, mime) });
  } catch (err) {
    logger.warn("[anotacoes] transcrição falhou", {
      organization_id: orgId,
      error: err instanceof Error ? err.message : String(err),
    });
    return desfechoDaTranscricao({ tipo: "erro" });
  }
}

/** Linhas → anotações prontas para a tela (URL assinada de 1h, nome do autor). */
export async function montarAnotacoes(
  linhas: LinhaDaAnotacao[],
  c: { userId: string; ehGerente: boolean; orgId: string; contatoId: string },
): Promise<Anotacao[]> {
  const admin = createAdminClient();
  const caminhos = linhas
    .map((l) => l.audio_path)
    .filter((p): p is string => audioDoContato(p, c.orgId, c.contatoId));
  const urls = new Map<string, string>();
  if (caminhos.length > 0) {
    const { data } = await admin.storage.from(BUCKET_DAS_ANOTACOES).createSignedUrls(caminhos, 3600);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  const nomes = await nomesDosAtendentes(linhas.map((l) => l.created_by));
  return linhas.map((l) =>
    paraAnotacao(l, {
      audioUrl: l.audio_path ? (urls.get(l.audio_path) ?? null) : null,
      nomeDoAutor: l.created_by ? (nomes.get(l.created_by) ?? null) : null,
      usuarioId: c.userId,
      ehGerente: c.ehGerente,
    }),
  );
}

export async function lerAnotacao(
  supabase: SupabaseClient,
  c: { orgId: string; contatoId: string },
  noteId: string,
): Promise<LinhaDaAnotacao | null> {
  const { data } = await supabase
    .from("contact_notes")
    .select(COLUNAS_DA_ANOTACAO)
    .eq("id", noteId)
    .eq("organization_id", c.orgId)
    .eq("contact_id", c.contatoId)
    .maybeSingle();
  return (data as LinhaDaAnotacao | null) ?? null;
}
