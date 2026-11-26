/**
 * GET /api/v1/reports/metas — aba Metas & Produtos.
 * Duas somas no banco (`fn_relatorio_metas` e `fn_relatorio_produtos`, migration 9112).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { metaVsRealizadoPorDia } from "@/lib/relatorios/metas";
import { preencherDias, preencherHoras } from "@/lib/relatorios/series";

import { comNome, funcaoAusente, lerContexto, nomesDasPessoas, uuidOuNulo } from "../_comum";

export const dynamic = "force-dynamic";

const INDISPONIVEL_9112 = {
  disponivel: false as const,
  motivo:
    "Esta aba precisa de uma atualização do banco (migration 9112). Peça a quem administra a instalação para aplicá-la.",
};

type Metas = {
  metas_total: number;
  alvo_empresa: number;
  alvo_por_funis: number;
  realizado: number;
  receita_cents: number;
  meses: { periodo: string; alvo: number }[];
  realizado_por_dia: { dia: string; total: number }[];
  por_funil: { pipeline_id: string; nome: string; alvo: number; realizado: number }[];
  por_vendedor: { user_id: string; vendas: number; receita_cents: number }[];
};
type Produtos = {
  produtos_distintos: number;
  itens_vendidos: number;
  receita_cents: number;
  descontos_cents: number;
  por_dia: { dia: string; total: number; receita_cents: number }[];
  por_hora: { hora: number; total: number }[];
  top_produtos: { nome: string; quantidade: number; receita_cents: number; descontos_cents: number }[];
  por_vendedor: { user_id: string; itens: number; receita_cents: number }[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  const args = {
    p_org: ctx.orgId,
    p_from: ctx.from.toISOString(),
    p_to: ctx.to.toISOString(),
    p_tz: ctx.tz,
    p_owner: uuidOuNulo(ctx.busca.get("owner_id")),
  };
  const [metas, produtos] = await Promise.all([
    ctx.supabase.rpc("fn_relatorio_metas", args),
    ctx.supabase.rpc("fn_relatorio_produtos", args),
  ]);
  const erro = metas.error ?? produtos.error;
  if (erro) {
    if (funcaoAusente(erro)) return ok(INDISPONIVEL_9112, { requestId });
    return fail("internal_error", "Não consegui montar o relatório agora.", 500, { requestId });
  }
  const m = metas.data as Metas;
  const p = produtos.data as Produtos;

  const dias = preencherDias([] as { dia: string }[], ctx.from, ctx.to, ctx.tz, (dia) => ({ dia })).map((d) => d.dia);
  const nomes = await nomesDasPessoas([
    ...m.por_vendedor.map((v) => v.user_id),
    ...p.por_vendedor.map((v) => v.user_id),
  ]);

  return ok(
    {
      disponivel: true as const,
      periodo: { from: ctx.from.toISOString(), to: ctx.to.toISOString(), tz: ctx.tz },
      metas: {
        metas_total: m.metas_total,
        alvo: m.alvo_empresa > 0 ? m.alvo_empresa : m.alvo_por_funis,
        realizado: m.realizado,
        receita_cents: m.receita_cents,
        meta_vs_realizado: metaVsRealizadoPorDia(m.meses, dias, m.realizado_por_dia),
        por_funil: m.por_funil,
        por_vendedor: m.por_vendedor.map(comNome(nomes)),
      },
      produtos: {
        produtos_distintos: p.produtos_distintos,
        itens_vendidos: p.itens_vendidos,
        receita_cents: p.receita_cents,
        descontos_cents: p.descontos_cents,
        por_dia: preencherDias(p.por_dia, ctx.from, ctx.to, ctx.tz, (dia) => ({ dia, total: 0, receita_cents: 0 })),
        por_hora: preencherHoras(p.por_hora),
        top_produtos: p.top_produtos,
        por_vendedor: p.por_vendedor.map(comNome(nomes)),
      },
    },
    { requestId },
  );
}
