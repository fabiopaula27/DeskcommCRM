/**
 * GET /api/v1/reports/atendimento — aba Atendimento dos Relatórios.
 * Soma em `fn_relatorio_atendimento` (migration 9111); aqui só se completa a
 * série (dias e horas sem movimento viram zero), a variação e os nomes.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { preencherDias, preencherHoras, variacao } from "@/lib/relatorios/series";

import {
  INDISPONIVEL,
  comNome,
  funcaoAusente,
  lerContexto,
  nomesDasPessoas,
  uuidOuNulo,
} from "../_comum";

export const dynamic = "force-dynamic";

type Dia = { dia: string; total: number };
type Hora = { hora: number; total: number };
type Numeros = { conversas: number; leads: number; vendas: number; receita_cents: number };
type Bruto = {
  hoje: Numeros;
  ontem: Numeros;
  trinta_dias: Numeros;
  conversas_por_dia: Dia[];
  conversas_resumo: Record<string, number | null>;
  por_canal: { canal: string; total: number }[];
  mensagens: { enviadas: number; humanas: number; ia: number; recebidas: number; conversas_com_mensagem: number };
  humanas_por_hora: Hora[];
  ia_por_hora: Hora[];
  ia_por_dia: Dia[];
  atendentes: { user_id: string; conversas: number; mensagens: number; leads: number; vendas: number }[];
  distribuicoes: { user_id: string; total: number }[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  const { data, error } = await ctx.supabase.rpc("fn_relatorio_atendimento", {
    p_org: ctx.orgId,
    p_from: ctx.from.toISOString(),
    p_to: ctx.to.toISOString(),
    p_tz: ctx.tz,
    p_user: uuidOuNulo(ctx.busca.get("user_id")),
  });
  if (error) {
    if (funcaoAusente(error)) return ok(INDISPONIVEL, { requestId });
    return fail("internal_error", "Não consegui montar o relatório agora.", 500, { requestId });
  }
  const b = data as Bruto;

  // Fila escolhida: a distribuição vem da função por fila (migration 9114).
  // Sem ela aplicada, segue a distribuição geral — o filtro só não restringe.
  const setor = uuidOuNulo(ctx.busca.get("setor_id"));
  if (setor) {
    const porFila = await ctx.supabase.rpc("fn_relatorio_distribuicoes", {
      p_org: ctx.orgId,
      p_from: ctx.from.toISOString(),
      p_to: ctx.to.toISOString(),
      p_setor: setor,
      p_user: uuidOuNulo(ctx.busca.get("user_id")),
    });
    if (!porFila.error && Array.isArray(porFila.data)) {
      b.distribuicoes = porFila.data as Bruto["distribuicoes"];
    }
  }

  const cartao = (chave: keyof Numeros) => ({
    hoje: b.hoje[chave],
    ontem: b.ontem[chave],
    trinta_dias: b.trinta_dias[chave],
    variacao: variacao(b.hoje[chave], b.ontem[chave]),
  });

  const nomes = await nomesDasPessoas([
    ...b.atendentes.map((a) => a.user_id),
    ...b.distribuicoes.map((d) => d.user_id),
  ]);
  const m = b.mensagens;

  return ok(
    {
      disponivel: true as const,
      periodo: { from: ctx.from.toISOString(), to: ctx.to.toISOString(), tz: ctx.tz },
      cartoes: {
        conversas: cartao("conversas"),
        leads: cartao("leads"),
        vendas: cartao("vendas"),
        receita_cents: cartao("receita_cents"),
      },
      conversas_por_dia: preencherDias(b.conversas_por_dia, ctx.from, ctx.to, ctx.tz, (dia) => ({ dia, total: 0 })),
      conversas_resumo: b.conversas_resumo,
      por_canal: b.por_canal,
      mensagens: {
        enviadas: m.enviadas,
        humanas: m.humanas,
        ia: m.ia,
        recebidas: m.recebidas,
        media_por_conversa:
          m.conversas_com_mensagem > 0
            ? Math.round(((m.enviadas + m.recebidas) / m.conversas_com_mensagem) * 10) / 10
            : null,
      },
      humanas_por_hora: preencherHoras(b.humanas_por_hora),
      ia_por_hora: preencherHoras(b.ia_por_hora),
      ia_por_dia: preencherDias(b.ia_por_dia, ctx.from, ctx.to, ctx.tz, (dia) => ({ dia, total: 0 })),
      atendentes: b.atendentes.map(comNome(nomes)),
      distribuicoes: b.distribuicoes.map(comNome(nomes)),
    },
    { requestId },
  );
}
