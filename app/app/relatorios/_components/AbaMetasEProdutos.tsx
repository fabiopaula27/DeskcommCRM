"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useRelatorio, type Indisponivel } from "@/hooks/relatorios/useRelatorio";

import { nomeDaLinha } from "./AbaAtendimento";
import {
  AvisoDaAba,
  Bloco,
  Carregando,
  GraficoDeDuasLinhas,
  GraficoPorDia,
  MapaPorHora,
  Numero,
  Progresso,
  TabelaRanking,
  Vazio,
} from "./blocos/Blocos";
import { CORES, formatarMoeda, formatarNumero, formatarPct, razao } from "./blocos/formato";
import type { FiltrosDoRelatorio, Pessoa } from "./RelatoriosClient";

type ComNome = { user_id: string; nome: string | null; email: string | null };
export type DadosDeMetas = {
  disponivel: true;
  metas: {
    metas_total: number;
    alvo: number;
    realizado: number;
    receita_cents: number;
    meta_vs_realizado: { dia: string; meta: number; realizado: number }[];
    por_funil: { pipeline_id: string; nome: string; alvo: number; realizado: number }[];
    por_vendedor: (ComNome & { vendas: number; receita_cents: number })[];
  };
  produtos: {
    produtos_distintos: number;
    itens_vendidos: number;
    receita_cents: number;
    descontos_cents: number;
    por_dia: { dia: string; total: number; receita_cents: number }[];
    por_hora: { hora: number; total: number }[];
    top_produtos: { nome: string; quantidade: number; receita_cents: number; descontos_cents: number }[];
    por_vendedor: (ComNome & { itens: number; receita_cents: number })[];
  };
};

export function AbaMetasEProdutos({
  filtros,
  moeda,
  pessoas,
}: {
  filtros: FiltrosDoRelatorio;
  moeda: string;
  pessoas: Pessoa[];
}) {
  const t = useT();
  const [dono, setDono] = useState("");
  const { data, isLoading, isError } = useRelatorio<DadosDeMetas>("metas", {
    ...filtros,
    owner_id: dono || undefined,
  });

  if (isLoading) return <Carregando />;
  if (isError || !data) return <AvisoDaAba texto={t("Não consegui carregar o relatório agora. Tente de novo em instantes.")} />;
  const d = data.data as DadosDeMetas | Indisponivel;
  if (!d.disponivel) return <AvisoDaAba texto={d.motivo} />;

  const m = d.metas;
  const p = d.produtos;
  const dinheiro = (c: number) => formatarMoeda(c, moeda);
  const atingimento = razao(m.realizado, m.alvo);
  const temMeta = m.alvo > 0;

  const filtro = (
    <select
      aria-label={t("Filtrar por vendedor")}
      value={dono}
      onChange={(e) => setDono(e.target.value)}
      className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
    >
      <option value="">{t("Todos os vendedores")}</option>
      {pessoas.map((x) => (
        <option key={x.user_id} value={x.user_id}>
          {x.nome}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-4">
      <Bloco
        titulo={t("Metas de vendas")}
        descricao={t("Meta de quantidade de vendas ganhas no período, cadastrada em Desempenho.")}
        acao={filtro}
      >
        {!temMeta ? (
          <p className="mb-4 rounded-md border border-dashed border-border bg-bg p-4 text-sm text-text-muted">
            {t("Nenhuma meta cadastrada para este período. Cadastre a meta do mês em Análise › Desempenho para acompanhar o atingimento aqui.")}
          </p>
        ) : null}
        <div className="mb-4 flex flex-wrap gap-2">
          <Numero rotulo={t("Metas no período")} valor={formatarNumero(m.metas_total)} />
          <Numero rotulo={t("Meta de vendas")} valor={temMeta ? formatarNumero(m.alvo) : "—"} tom="destaque" />
          <Numero rotulo={t("Vendas realizadas")} valor={formatarNumero(m.realizado)} tom="sucesso" />
          <Numero rotulo={t("Receita realizada")} valor={dinheiro(m.receita_cents)} />
          <Numero rotulo={t("Atingimento")} valor={temMeta ? formatarPct(atingimento) : "—"} tom="alerta" />
        </div>
        {temMeta ? (
          <div className="mb-6">
            <Progresso fracao={atingimento} />
          </div>
        ) : null}
        <GraficoDeDuasLinhas
          serie={m.meta_vs_realizado}
          a={{ chave: "meta", rotulo: t("Meta acumulada"), cor: "var(--color-text-subtle)", tracejada: true }}
          b={{ chave: "realizado", rotulo: t("Vendas acumuladas"), cor: "var(--color-success)" }}
        />
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-text-muted">{t("Por funil")}</p>
            {m.por_funil.length === 0 ? (
              <Vazio texto={t("Sem metas ou vendas por funil no período.")} />
            ) : (
              <ul className="space-y-3">
                {m.por_funil.map((f) => (
                  <li key={f.pipeline_id}>
                    <div className="mb-1 flex justify-between gap-2 text-sm">
                      <span className="truncate">{f.nome}</span>
                      <span className="tabular-nums text-text-muted">
                        {formatarNumero(f.realizado)}
                        {f.alvo > 0 ? ` / ${formatarNumero(f.alvo)}` : ""}
                      </span>
                    </div>
                    {f.alvo > 0 ? <Progresso fracao={razao(f.realizado, f.alvo)} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-text-muted">{t("Por vendedor")}</p>
            <TabelaRanking
              linhas={m.por_vendedor}
              nome={(l) => nomeDaLinha(l, t)}
              vazio={t("Nenhuma venda no período.")}
              porPagina={5}
              colunas={[
                { titulo: t("Vendas"), valor: (l) => formatarNumero(l.vendas) },
                { titulo: t("Receita"), valor: (l) => dinheiro(l.receita_cents) },
              ]}
            />
          </div>
        </div>
      </Bloco>

      <Bloco titulo={t("Produtos")} descricao={t("Itens de propostas aceitas no período.")}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Numero rotulo={t("Produtos diferentes")} valor={formatarNumero(p.produtos_distintos)} />
          <Numero rotulo={t("Itens vendidos")} valor={formatarNumero(p.itens_vendidos)} tom="destaque" />
          <Numero rotulo={t("Receita")} valor={dinheiro(p.receita_cents)} tom="sucesso" />
          <Numero rotulo={t("Descontos dados")} valor={dinheiro(p.descontos_cents)} tom="alerta" />
        </div>
        <p className="mb-2 text-xs font-medium text-text-muted">{t("Receita de produtos por dia")}</p>
        <GraficoPorDia serie={p.por_dia} chave="receita_cents" cor={CORES[0]} formatar={dinheiro} altura={200} />
        <div className="mt-6">
          <MapaPorHora titulo={t("Itens vendidos por hora")} horas={p.por_hora} cor="var(--color-success)" />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium text-text-muted">{t("Produtos mais vendidos")}</p>
            {p.top_produtos.length === 0 ? (
              <Vazio texto={t("Nenhuma proposta com produto foi aceita no período.")} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="py-2 font-medium">{t("Produto")}</th>
                    <th className="py-2 text-right font-medium">{t("Qtd")}</th>
                    <th className="py-2 text-right font-medium">{t("Receita")}</th>
                    <th className="py-2 text-right font-medium">{t("Desconto")}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.top_produtos.map((x) => (
                    <tr key={x.nome} className="border-b border-border/60 last:border-0">
                      <td className="py-2">{x.nome}</td>
                      <td className="py-2 text-right tabular-nums">{formatarNumero(x.quantidade)}</td>
                      <td className="py-2 text-right tabular-nums">{dinheiro(x.receita_cents)}</td>
                      <td className="py-2 text-right tabular-nums text-text-muted">{dinheiro(x.descontos_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-text-muted">{t("Por vendedor")}</p>
            <TabelaRanking
              linhas={p.por_vendedor}
              nome={(l) => nomeDaLinha(l, t)}
              vazio={t("Nenhum vendedor com produtos vendidos no período.")}
              porPagina={5}
              colunas={[
                { titulo: t("Itens"), valor: (l) => formatarNumero(l.itens) },
                { titulo: t("Receita"), valor: (l) => dinheiro(l.receita_cents) },
              ]}
            />
          </div>
        </div>
      </Bloco>
    </div>
  );
}
