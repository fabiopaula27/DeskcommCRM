"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useRelatorio, type Indisponivel } from "@/hooks/relatorios/useRelatorio";

import { nomeDaLinha } from "./AbaAtendimento";
import { AvisoDaAba, Bloco, Carregando, GraficoPorDia, Numero, Rosca, TabelaRanking } from "./blocos/Blocos";
import { CORES, formatarMoeda, formatarNumero, formatarPct, razao, rotuloDoDia } from "./blocos/formato";
import type { FiltrosDoRelatorio, Pessoa } from "./RelatoriosClient";

export type DadosDeLeads = {
  disponivel: true;
  leads_total: number;
  convertidos: number;
  leads_por_dia: { dia: string; total: number }[];
  origens: { origem: string; total: number }[];
  vendas_total: number;
  receita_cents: number;
  vendas_por_dia: { dia: string; total: number; receita_cents: number }[];
  vendedores: {
    user_id: string;
    nome: string | null;
    email: string | null;
    leads: number;
    vendas: number;
    receita_cents: number;
  }[];
};

export function AbaLeadsEVendas({
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
  const { data, isLoading, isError } = useRelatorio<DadosDeLeads>("leads", {
    ...filtros,
    owner_id: dono || undefined,
  });

  if (isLoading) return <Carregando />;
  if (isError || !data) return <AvisoDaAba texto={t("Não consegui carregar o relatório agora. Tente de novo em instantes.")} />;
  const d = data.data as DadosDeLeads | Indisponivel;
  if (!d.disponivel) return <AvisoDaAba texto={d.motivo} />;

  const dinheiro = (c: number) => formatarMoeda(c, moeda);
  const ticket = d.vendas_total > 0 ? Math.round(d.receita_cents / d.vendas_total) : 0;
  const melhores = [...d.vendas_por_dia]
    .filter((v) => v.total > 0)
    .sort((a, b) => b.receita_cents - a.receita_cents || b.total - a.total)
    .slice(0, 3);

  const filtro = (
    <select
      aria-label={t("Filtrar por vendedor")}
      value={dono}
      onChange={(e) => setDono(e.target.value)}
      className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
    >
      <option value="">{t("Todos os vendedores")}</option>
      {pessoas.map((p) => (
        <option key={p.user_id} value={p.user_id}>
          {p.nome}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Bloco titulo={t("Leads por dia")} acao={filtro} className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2">
            <Numero rotulo={t("Leads")} valor={formatarNumero(d.leads_total)} tom="destaque" />
            <Numero rotulo={t("Viraram venda")} valor={formatarNumero(d.convertidos)} tom="sucesso" />
            <Numero rotulo={t("Taxa de conversão")} valor={formatarPct(razao(d.convertidos, d.leads_total))} />
          </div>
          <GraficoPorDia serie={d.leads_por_dia} chave="total" cor={CORES[2]} />
        </Bloco>
        <Bloco titulo={t("De onde vieram")}>
          <Rosca rotuloDoCentro={t("Leads")} itens={d.origens.map((o) => ({ rotulo: o.origem, total: o.total }))} />
        </Bloco>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Bloco titulo={t("Vendas por dia")} className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2">
            <Numero rotulo={t("Vendas")} valor={formatarNumero(d.vendas_total)} tom="destaque" />
            <Numero rotulo={t("Receita")} valor={dinheiro(d.receita_cents)} tom="sucesso" />
            <Numero rotulo={t("Ticket médio")} valor={dinheiro(ticket)} />
          </div>
          <GraficoPorDia serie={d.vendas_por_dia} chave="receita_cents" cor={CORES[3]} formatar={dinheiro} />
        </Bloco>
        <Bloco titulo={t("Resumo de vendas")}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between rounded-md bg-bg px-3 py-2">
              <dt className="text-text-muted">{t("Vendas")}</dt>
              <dd className="font-semibold tabular-nums">{formatarNumero(d.vendas_total)}</dd>
            </div>
            <div className="flex justify-between rounded-md bg-bg px-3 py-2">
              <dt className="text-text-muted">{t("Receita")}</dt>
              <dd className="font-semibold tabular-nums">{dinheiro(d.receita_cents)}</dd>
            </div>
            <div className="flex justify-between rounded-md bg-bg px-3 py-2">
              <dt className="text-text-muted">{t("Ticket médio")}</dt>
              <dd className="font-semibold tabular-nums">{dinheiro(ticket)}</dd>
            </div>
          </dl>
          <p className="mt-5 mb-2 text-xs font-medium text-text-muted">{t("Melhores dias")}</p>
          {melhores.length === 0 ? (
            <p className="text-sm text-text-muted">{t("Nenhuma venda no período.")}</p>
          ) : (
            <ol data-testid="melhores-dias" className="space-y-1 text-sm">
              {melhores.map((v) => (
                <li key={v.dia} className="flex justify-between">
                  <span>{rotuloDoDia(v.dia)}</span>
                  <span className="tabular-nums text-text-muted">
                    {formatarNumero(v.total)} · {dinheiro(v.receita_cents)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Bloco>
      </div>

      <Bloco titulo={t("Vendas por vendedor")}>
        <TabelaRanking
          linhas={d.vendedores}
          nome={(l) => nomeDaLinha(l, t)}
          vazio={t("Nenhum vendedor com leads ou vendas no período.")}
          colunas={[
            { titulo: t("Leads"), valor: (l) => formatarNumero(l.leads) },
            { titulo: t("Vendas"), valor: (l) => formatarNumero(l.vendas) },
            { titulo: t("Receita"), valor: (l) => dinheiro(l.receita_cents) },
            {
              titulo: t("Ticket médio"),
              valor: (l) => dinheiro(l.vendas > 0 ? Math.round(l.receita_cents / l.vendas) : 0),
            },
            { titulo: t("Conversão"), valor: (l) => formatarPct(razao(l.vendas, l.leads)) },
          ]}
        />
      </Bloco>
    </div>
  );
}
