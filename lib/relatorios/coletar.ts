/**
 * Junta os números do relatório para o PDF, pelas MESMAS funções das abas
 * (migrations 9111 e 9112, e `fn_uso_de_ia`). Cada seção é independente: a que
 * falhar (ex.: migration não aplicada) vira `null` e o PDF a omite.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { tokensDe } from "./ia";
import { metaVsRealizadoPorDia } from "./metas";
import { preencherDias } from "./series";
import { gastoEstimadoUsd } from "./templates";

export type Nomeador = (ids: string[]) => Promise<Map<string, string>>;

export type DadosDoPdf = {
  periodo: { de: string; ate: string };
  atendimento: {
    conversas: number;
    ativas: number;
    pausadas: number;
    primeira_resposta_s: number | null;
    enviadas: number;
    enviadas_ia: number;
    recebidas: number;
    por_dia: { dia: string; total: number }[];
    canais: { rotulo: string; total: number }[];
    atendentes: { nome: string; conversas: number; mensagens: number; vendas: number }[];
  } | null;
  leads: {
    leads: number;
    convertidos: number;
    vendas: number;
    receita_cents: number;
    por_dia: { dia: string; total: number }[];
    origens: { rotulo: string; total: number }[];
    vendedores: { nome: string; leads: number; vendas: number; receita_cents: number }[];
  } | null;
  funil: { funis: { nome: string; leads: number; valor_cents: number }[] } | null;
  metas: { alvo: number; realizado: number; produtos_itens: number; produtos_receita_cents: number; top_produtos: { nome: string; quantidade: number; receita_cents: number }[] } | null;
  templates: { enviados: number; respondidos: number; gasto_usd: number } | null;
  ia: { tokens: number; custo_cents: number; turnos: number } | null;
};

type Rpc = { data: unknown; error: unknown };

export async function coletarDadosDoPdf(
  supabase: SupabaseClient,
  args: { orgId: string; tz: string; from: Date; to: Date; de: string; ate: string },
  nomear: Nomeador,
): Promise<DadosDoPdf> {
  const base = { p_org: args.orgId, p_from: args.from.toISOString(), p_to: args.to.toISOString() };
  const comTz = { ...base, p_tz: args.tz };
  const chamar = (nome: string, a: Record<string, unknown>) =>
    (supabase.rpc(nome, a) as unknown as Promise<Rpc>).catch((e: unknown) => ({ data: null, error: e }));

  const [at, ld, fu, me, pr, tp, ia] = await Promise.all([
    chamar("fn_relatorio_atendimento", { ...comTz, p_user: null }),
    chamar("fn_relatorio_leads", { ...comTz, p_owner: null }),
    chamar("fn_relatorio_funil", { ...base, p_pipeline: null }),
    chamar("fn_relatorio_metas", { ...comTz, p_owner: null }),
    chamar("fn_relatorio_produtos", { ...comTz, p_owner: null }),
    chamar("fn_relatorio_templates", { ...comTz, p_template: null }),
    chamar("fn_uso_de_ia", {
      p_org: args.orgId,
      p_desde: args.from.toISOString(),
      p_ate: new Date(args.to.getTime() - 1).toISOString(),
      p_agent_id: null,
      p_purpose: null,
    }),
  ]);
  const ok = (r: Rpc) => (r.error || !r.data ? null : (r.data as Record<string, any>)); // eslint-disable-line @typescript-eslint/no-explicit-any

  const A = ok(at);
  const L = ok(ld);
  const ids = [
    ...((A?.atendentes ?? []) as { user_id: string }[]).map((x) => x.user_id),
    ...((L?.vendedores ?? []) as { user_id: string }[]).map((x) => x.user_id),
  ];
  const nomes = await nomear(ids);
  const nome = (id: string) => nomes.get(id) ?? "Pessoa";
  const dias = (s: { dia: string; total: number }[] | undefined) =>
    preencherDias(s ?? [], args.from, args.to, args.tz, (dia) => ({ dia, total: 0 }));

  const F = ok(fu);
  const M = ok(me);
  const P = ok(pr);
  const T = ok(tp);
  const I = ok(ia);

  let metas: DadosDoPdf["metas"] = null;
  if (M) {
    const serie = metaVsRealizadoPorDia(M.meses ?? [], dias([]).map((d) => d.dia), M.realizado_por_dia ?? []);
    metas = {
      alvo: Math.round((serie.at(-1)?.meta ?? 0) * 100) / 100,
      realizado: M.realizado ?? 0,
      produtos_itens: P?.itens_vendidos ?? 0,
      produtos_receita_cents: P?.receita_cents ?? 0,
      top_produtos: ((P?.top_produtos ?? []) as { nome: string; quantidade: number; receita_cents: number }[]).slice(0, 5),
    };
  }

  return {
    periodo: { de: args.de, ate: args.ate },
    atendimento: A
      ? {
          conversas: A.conversas_resumo?.total ?? 0,
          ativas: A.conversas_resumo?.ativas ?? 0,
          pausadas: A.conversas_resumo?.pausadas ?? 0,
          primeira_resposta_s: A.conversas_resumo?.tempo_primeira_resposta_s ?? null,
          enviadas: A.mensagens?.enviadas ?? 0,
          enviadas_ia: A.mensagens?.ia ?? 0,
          recebidas: A.mensagens?.recebidas ?? 0,
          por_dia: dias(A.conversas_por_dia),
          canais: ((A.por_canal ?? []) as { canal: string; total: number }[]).map((c) => ({ rotulo: c.canal, total: c.total })),
          atendentes: ((A.atendentes ?? []) as { user_id: string; conversas: number; mensagens: number; vendas: number }[])
            .slice(0, 10)
            .map((x) => ({ nome: nome(x.user_id), conversas: x.conversas, mensagens: x.mensagens, vendas: x.vendas })),
        }
      : null,
    leads: L
      ? {
          leads: L.leads_total ?? 0,
          convertidos: L.convertidos ?? 0,
          vendas: L.vendas_total ?? 0,
          receita_cents: L.receita_cents ?? 0,
          por_dia: dias(L.leads_por_dia),
          origens: ((L.origens ?? []) as { origem: string; total: number }[]).map((o) => ({ rotulo: o.origem, total: o.total })),
          vendedores: ((L.vendedores ?? []) as { user_id: string; leads: number; vendas: number; receita_cents: number }[])
            .slice(0, 10)
            .map((x) => ({ nome: nome(x.user_id), leads: x.leads, vendas: x.vendas, receita_cents: x.receita_cents })),
        }
      : null,
    funil: F ? { funis: ((F.funis ?? []) as { nome: string; leads: number; valor_cents: number }[]) } : null,
    metas,
    templates: T
      ? { enviados: T.enviados ?? 0, respondidos: T.respondidos ?? 0, gasto_usd: gastoEstimadoUsd(T.por_template ?? []) }
      : null,
    ia: I
      ? {
          tokens: I.totais ? tokensDe(I.totais) : 0,
          custo_cents: Number(I.totais?.custo_cents ?? 0),
          turnos: I.totais?.turnos ?? 0,
        }
      : null,
  };
}
