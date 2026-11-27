/** GET /api/v1/reports/templates — aba Templates Oficiais (`fn_relatorio_templates`, migration 9112). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { preencherDias } from "@/lib/relatorios/series";
import { gastoEstimadoUsd, tarifaDaCategoria } from "@/lib/relatorios/templates";

import { funcaoAusente, lerContexto } from "../_comum";

export const dynamic = "force-dynamic";

type Bruto = {
  enviados: number;
  respondidos: number;
  por_dia: { dia: string; enviados: number; respondidos: number }[];
  por_template: { nome: string; categoria: string | null; enviados: number; respondidos: number }[];
  nomes: string[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  const template = ctx.busca.get("template");
  const { data, error } = await ctx.supabase.rpc("fn_relatorio_templates", {
    p_org: ctx.orgId,
    p_from: ctx.from.toISOString(),
    p_to: ctx.to.toISOString(),
    p_tz: ctx.tz,
    p_template: template && template.length <= 512 ? template : null,
  });
  if (error) {
    if (funcaoAusente(error)) {
      return ok(
        {
          disponivel: false as const,
          motivo:
            "Esta aba precisa de uma atualização do banco (migration 9112). Peça a quem administra a instalação para aplicá-la.",
        },
        { requestId },
      );
    }
    return fail("internal_error", "Não consegui montar o relatório agora.", 500, { requestId });
  }
  const b = data as Bruto;

  return ok(
    {
      disponivel: true as const,
      periodo: { from: ctx.from.toISOString(), to: ctx.to.toISOString(), tz: ctx.tz },
      enviados: b.enviados,
      respondidos: b.respondidos,
      gasto_estimado_usd: gastoEstimadoUsd(b.por_template),
      por_dia: preencherDias(b.por_dia, ctx.from, ctx.to, ctx.tz, (dia) => ({ dia, enviados: 0, respondidos: 0 })),
      por_template: b.por_template.map((t) => ({
        ...t,
        gasto_estimado_usd: t.enviados * tarifaDaCategoria(t.categoria),
      })),
      nomes: b.nomes,
      // Sem categoria conhecida (nula ou antiga) não tem tarifa e fica fora do gasto.
      sem_categoria: (() => {
        const conhecidas = ["MARKETING", "UTILITY", "AUTHENTICATION"];
        const fora = b.por_template.filter(
          (t) => t.enviados > 0 && !conhecidas.includes((t.categoria ?? "").toUpperCase()),
        );
        return { templates: fora.length, enviados: fora.reduce((s, t) => s + t.enviados, 0) };
      })(),
    },
    { requestId },
  );
}
