/** GET /api/v1/reports/funil — aba Funil (soma em `fn_relatorio_funil`, migration 9111). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";

import { INDISPONIVEL, funcaoAusente, lerContexto, uuidOuNulo } from "../_comum";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  const { data, error } = await ctx.supabase.rpc("fn_relatorio_funil", {
    p_org: ctx.orgId,
    p_from: ctx.from.toISOString(),
    p_to: ctx.to.toISOString(),
    p_pipeline: uuidOuNulo(ctx.busca.get("pipeline_id")),
  });
  if (error) {
    if (funcaoAusente(error)) return ok(INDISPONIVEL, { requestId });
    return fail("internal_error", "Não consegui montar o relatório agora.", 500, { requestId });
  }
  const b = data as {
    funis: { pipeline_id: string; nome: string; posicao: number; leads: number; valor_cents: number }[];
    etapas: { pipeline_id: string; stage_id: string; nome: string; posicao: number; leads: number }[];
  };

  return ok(
    {
      disponivel: true as const,
      periodo: { from: ctx.from.toISOString(), to: ctx.to.toISOString(), tz: ctx.tz },
      funis: b.funis,
      etapas: b.etapas,
    },
    { requestId },
  );
}
