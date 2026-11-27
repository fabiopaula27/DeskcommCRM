/**
 * GET /api/v1/reports/pdf?from&to — o PDF do relatório do período, gerado no
 * servidor (o mesmo arquivo do envio agendado). Piso `manager`, org ativa.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { coletarDadosDoPdf } from "@/lib/relatorios/coletar";
import { dadosDaEmpresa, nomeadorPeloAuth } from "@/lib/relatorios/envio-real";
import { diaNoFuso } from "@/lib/relatorios/periodo";
import { gerarPdfDoRelatorio } from "@/lib/relatorios/pdf";
import { createAdminClient } from "@/lib/supabase/admin";

import { lerContexto } from "../_comum";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  try {
    const admin = createAdminClient() as unknown as SupabaseClient;
    const e = await dadosDaEmpresa(admin, ctx.orgId);
    const de = diaNoFuso(ctx.from, ctx.tz);
    const ate = diaNoFuso(new Date(ctx.to.getTime() - 1), ctx.tz);
    // Os números vêm pelo client da SESSÃO (RLS de quem pede), como as abas.
    const dados = await coletarDadosDoPdf(
      ctx.supabase,
      { orgId: ctx.orgId, tz: ctx.tz, from: ctx.from, to: ctx.to, de, ate },
      nomeadorPeloAuth(admin),
    );
    const pdf = await gerarPdfDoRelatorio(dados, { empresa: e.empresa, sistema: e.sistema, moeda: e.moeda });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="relatorio-${de}_a_${ate}.pdf"`,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch {
    return fail("internal_error", "Não consegui gerar o PDF agora.", 500, { requestId });
  }
}
