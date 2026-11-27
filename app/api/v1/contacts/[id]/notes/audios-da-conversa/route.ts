/**
 * GET /api/v1/contacts/[id]/notes/audios-da-conversa — os últimos 20 áudios
 * que o lead mandou no WhatsApp, para escolher um e virar anotação.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { MARCADOR_NAO_LIDA } from "@/lib/messaging/media/derivable";
import { createAdminClient } from "@/lib/supabase/admin";

import { contextoDasAnotacoes, type Ctx } from "../_comum";

export const dynamic = "force-dynamic";

export type AudioDaConversa = { id: string; enviadoEm: string; trecho: string | null; temArquivo: boolean };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "agent");
  if (!c.ok) return c.response;
  const { data, error } = await createAdminClient()
    .from("messages")
    .select("id, created_at, media_storage_path, media_derived_text, media_derived_status")
    .eq("organization_id", c.orgId)
    .eq("contact_id", c.contatoId)
    .eq("type", "audio")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return fail("internal_error", "Não consegui ler os áudios da conversa.", 500, { requestId });
  const audios: AudioDaConversa[] = (
    (data ?? []) as {
      id: string;
      created_at: string;
      media_storage_path: string | null;
      media_derived_text: string | null;
      media_derived_status: string | null;
    }[]
  ).map((m) => {
    const texto = (m.media_derived_text ?? "").trim();
    const legivel = m.media_derived_status === "ready" && texto !== "" && texto !== MARCADOR_NAO_LIDA;
    return {
      id: m.id,
      enviadoEm: m.created_at,
      trecho: legivel ? texto.slice(0, 160) : null,
      temArquivo: Boolean(m.media_storage_path),
    };
  });
  return ok({ audios }, { requestId });
}
