/**
 * GET /api/v1/reports/ia — aba Consumo de IA.
 * Reaproveita `fn_uso_de_ia` (a soma da tela Uso de IA): os números batem com
 * ela. Duas leituras: o período escolhido e os últimos 12 meses (histórico).
 * Os dias dessa função são agrupados em UTC — é a régua da tela de origem.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { rotuloDoUso, somarPorMes, tokensDe } from "@/lib/relatorios/ia";
import { diaNoFuso, inicioDoDia } from "@/lib/relatorios/periodo";
import { preencherDias } from "@/lib/relatorios/series";

import { funcaoAusente, lerContexto } from "../_comum";

export const dynamic = "force-dynamic";

type Linha = {
  chamadas: number;
  custo_cents: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};
type Uso = {
  totais: (Linha & { turnos?: number; custo_dos_turnos_cents?: number }) | null;
  dias: (Linha & { dia: string })[];
  purposes: (Linha & { purpose: string })[];
};

const ZERO: Linha = {
  chamadas: 0, custo_cents: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
};

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await lerContexto(req, requestId);
  if (!ctx.ok) return ctx.response;

  // `fn_uso_de_ia` usa `<= p_ate`; o fim do período aqui é exclusivo.
  const ateInclusivo = new Date(ctx.to.getTime() - 1).toISOString();
  const hoje = diaNoFuso(new Date(), ctx.tz);
  const [ano = 1970, mes = 1] = hoje.split("-").map(Number);
  const inicioHistorico = new Date(Date.UTC(ano, mes - 1 - 11, 1)).toISOString().slice(0, 10);

  const [periodo, historico] = await Promise.all([
    ctx.supabase.rpc("fn_uso_de_ia", {
      p_org: ctx.orgId, p_desde: ctx.from.toISOString(), p_ate: ateInclusivo, p_agent_id: null, p_purpose: null,
    }),
    ctx.supabase.rpc("fn_uso_de_ia", {
      p_org: ctx.orgId,
      p_desde: inicioDoDia(inicioHistorico, ctx.tz).toISOString(),
      p_ate: new Date().toISOString(),
      p_agent_id: null,
      p_purpose: null,
    }),
  ]);
  const erro = periodo.error ?? historico.error;
  if (erro) {
    if (funcaoAusente(erro)) {
      return ok(
        { disponivel: false as const, motivo: "O registro de uso de IA ainda não está disponível nesta instalação." },
        { requestId },
      );
    }
    return fail("internal_error", "Não consegui montar o relatório agora.", 500, { requestId });
  }

  const u = periodo.data as Uso;
  const h = historico.data as Uso;
  const totais = { ...ZERO, ...(u.totais ?? {}) };
  const turnos = u.totais?.turnos ?? 0;

  const porUso = new Map<string, { uso: string; tokens: number; custo_cents: number; chamadas: number }>();
  for (const p of u.purposes ?? []) {
    const uso = rotuloDoUso(p.purpose);
    const atual = porUso.get(uso) ?? { uso, tokens: 0, custo_cents: 0, chamadas: 0 };
    atual.tokens += tokensDe(p);
    atual.custo_cents += Number(p.custo_cents ?? 0);
    atual.chamadas += p.chamadas ?? 0;
    porUso.set(uso, atual);
  }

  return ok(
    {
      disponivel: true as const,
      periodo: { from: ctx.from.toISOString(), to: ctx.to.toISOString(), tz: ctx.tz },
      tokens: tokensDe(totais),
      tokens_entrada: totais.input_tokens,
      tokens_saida: totais.output_tokens,
      tokens_cache: totais.cache_read_tokens + totais.cache_write_tokens,
      custo_cents: Number(totais.custo_cents),
      chamadas: totais.chamadas,
      turnos,
      custo_por_turno_cents: turnos > 0 ? Math.round(Number(u.totais?.custo_dos_turnos_cents ?? 0) / turnos) : null,
      por_uso: [...porUso.values()].sort((a, b) => b.tokens - a.tokens),
      por_dia: preencherDias(
        (u.dias ?? []).map((d) => ({ dia: d.dia, tokens: tokensDe(d), custo_cents: Number(d.custo_cents) })),
        ctx.from,
        ctx.to,
        ctx.tz,
        (dia) => ({ dia, tokens: 0, custo_cents: 0 }),
      ),
      historico: somarPorMes(h.dias ?? []),
    },
    { requestId },
  );
}
