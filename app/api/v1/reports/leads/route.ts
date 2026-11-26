/** GET /api/v1/reports/leads — aba Leads & Vendas (soma em `fn_relatorio_leads`, migration 9111). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { preencherDias } from "@/lib/relatorios/series";

import {
  INDISPONIVEL,
  comNome,
  funcaoAusente,
  lerContexto,
  nomesDasPessoas,
  uuidOuNulo,
} from "../_comum";

export const dynamic = "force-dynamic";

type Bruto = {
  leads_total: number;
  convertidos: number;
  leads_por_dia: { dia: string; total: number }[];
  origens: { origem: string; total: number }[];
  vendas_total: number;
  receita_cents: number;
  vendas_por_dia: { dia: string; total: number; receita_cents: number }[];
  vendedores: { user_id: string; leads: number; vendas: number; receita_cents: number }[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  const { data, error } = await ctx.supabase.rpc("fn_relatorio_leads", {
    p_org: ctx.orgId,
    p_from: ctx.from.toISOString(),
    p_to: ctx.to.toISOString(),
    p_tz: ctx.tz,
    p_owner: uuidOuNulo(ctx.busca.get("owner_id")),
  });
  if (error) {
    if (funcaoAusente(error)) return ok(INDISPONIVEL, { requestId });
    return fail("internal_error", "Não consegui montar o relatório agora.", 500, { requestId });
  }
  const b = data as Bruto;
  const nomes = await nomesDasPessoas(b.vendedores.map((v) => v.user_id));

  return ok(
    {
      disponivel: true as const,
      periodo: { from: ctx.from.toISOString(), to: ctx.to.toISOString(), tz: ctx.tz },
      leads_total: b.leads_total,
      convertidos: b.convertidos,
      leads_por_dia: preencherDias(b.leads_por_dia, ctx.from, ctx.to, ctx.tz, (dia) => ({ dia, total: 0 })),
      origens: b.origens,
      vendas_total: b.vendas_total,
      receita_cents: b.receita_cents,
      vendas_por_dia: preencherDias(b.vendas_por_dia, ctx.from, ctx.to, ctx.tz, (dia) => ({
        dia,
        total: 0,
        receita_cents: 0,
      })),
      vendedores: b.vendedores.map(comNome(nomes)),
    },
    { requestId },
  );
}
