"use client";

import { useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { useRelatorio, type Indisponivel } from "@/hooks/relatorios/useRelatorio";
import type { Variacao } from "@/lib/relatorios/series";

import {
  AvisoDaAba,
  Bloco,
  Carregando,
  CartaoDoDia,
  GraficoPorDia,
  MapaPorHora,
  Numero,
  Rosca,
  TabelaRanking,
} from "./blocos/Blocos";
import { CORES, formatarDuracao, formatarMoeda, formatarNumero, formatarPct, razao } from "./blocos/formato";
import type { FiltrosDoRelatorio, Pessoa } from "./RelatoriosClient";

type Cartao = { hoje: number; ontem: number; trinta_dias: number; variacao: Variacao };
type Linha = { user_id: string; nome: string | null; email: string | null };
export type DadosDeAtendimento = {
  disponivel: true;
  cartoes: { conversas: Cartao; leads: Cartao; vendas: Cartao; receita_cents: Cartao };
  conversas_por_dia: { dia: string; total: number }[];
  conversas_resumo: {
    total: number;
    ativas: number;
    pausadas: number;
    tempo_medio_atendimento_s: number | null;
    tempo_primeira_resposta_s: number | null;
  };
  por_canal: { canal: string; total: number }[];
  mensagens: { enviadas: number; humanas: number; ia: number; recebidas: number; media_por_conversa: number | null };
  humanas_por_hora: { hora: number; total: number }[];
  ia_por_hora: { hora: number; total: number }[];
  ia_por_dia: { dia: string; total: number }[];
  atendentes: (Linha & { conversas: number; mensagens: number; leads: number; vendas: number })[];
  distribuicoes: (Linha & { total: number })[];
};

const NOME_DO_CANAL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
  email: "E-mail",
  outro: "Outros",
};

export function nomeDaLinha(l: Linha, t: (s: string) => string) {
  return { nome: l.nome ?? l.email ?? t("Pessoa sem nome"), detalhe: l.nome ? l.email : null };
}

export function AbaAtendimento({
  filtros,
  moeda,
  pessoas,
  filas = [],
}: {
  filtros: FiltrosDoRelatorio;
  moeda: string;
  pessoas: Pessoa[];
  filas?: { id: string; nome: string }[];
}) {
  const t = useT();
  const [pessoa, setPessoa] = useState("");
  const [fila, setFila] = useState("");
  const { data, isLoading, isError } = useRelatorio<DadosDeAtendimento>("atendimento", {
    ...filtros,
    user_id: pessoa || undefined,
    setor_id: fila || undefined,
  });

  if (isLoading) return <Carregando />;
  if (isError || !data) return <AvisoDaAba texto={t("Não consegui carregar o relatório agora. Tente de novo em instantes.")} />;
  const d = data.data as DadosDeAtendimento | Indisponivel;
  if (!d.disponivel) return <AvisoDaAba texto={d.motivo} />;

  const c = d.cartoes;
  const r = d.conversas_resumo;
  const m = d.mensagens;
  const ranking = [...d.atendentes].sort((a, b) => b.conversas - a.conversas);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CartaoDoDia
          titulo={t("Conversas hoje")}
          hoje={formatarNumero(c.conversas.hoje)}
          variacao={c.conversas.variacao}
          trintaDias={formatarNumero(c.conversas.trinta_dias)}
        />
        <CartaoDoDia
          titulo={t("Leads hoje")}
          hoje={formatarNumero(c.leads.hoje)}
          variacao={c.leads.variacao}
          trintaDias={formatarNumero(c.leads.trinta_dias)}
        />
        <CartaoDoDia
          titulo={t("Vendas hoje")}
          hoje={formatarNumero(c.vendas.hoje)}
          variacao={c.vendas.variacao}
          trintaDias={formatarNumero(c.vendas.trinta_dias)}
        />
        <CartaoDoDia
          titulo={t("Receita hoje")}
          hoje={formatarMoeda(c.receita_cents.hoje, moeda)}
          variacao={c.receita_cents.variacao}
          trintaDias={formatarMoeda(c.receita_cents.trinta_dias, moeda)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Bloco titulo={t("Conversas por dia")} className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2">
            <Numero rotulo={t("Total")} valor={formatarNumero(r.total)} tom="destaque" />
            <Numero rotulo={t("Ativas")} valor={formatarNumero(r.ativas)} tom="sucesso" />
            <Numero rotulo={t("IA pausada")} valor={formatarNumero(r.pausadas)} tom="alerta" />
            <Numero rotulo={t("Tempo médio de atendimento")} valor={formatarDuracao(r.tempo_medio_atendimento_s)} />
            <Numero rotulo={t("Tempo da 1ª resposta")} valor={formatarDuracao(r.tempo_primeira_resposta_s)} />
          </div>
          <GraficoPorDia serie={d.conversas_por_dia} chave="total" />
        </Bloco>
        <Bloco titulo={t("Por canal")}>
          <Rosca
            rotuloDoCentro={t("Conversas")}
            itens={d.por_canal.map((p) => ({ rotulo: t(NOME_DO_CANAL[p.canal] ?? p.canal), total: p.total }))}
          />
        </Bloco>
      </div>

      <Bloco
        titulo={t("Mensagens")}
        acao={
          <select
            aria-label={t("Filtrar por atendente")}
            value={pessoa}
            onChange={(e) => setPessoa(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">{t("Todos os atendentes")}</option>
            {pessoas.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.nome}
              </option>
            ))}
          </select>
        }
      >
        <div className="mb-5 flex flex-wrap gap-2">
          <Numero rotulo={t("Enviadas")} valor={formatarNumero(m.enviadas)} tom="destaque" />
          <Numero rotulo={t("Por pessoas")} valor={formatarNumero(m.humanas)} />
          <Numero rotulo={t("Pela IA")} valor={formatarNumero(m.ia)} />
          <Numero rotulo={t("Recebidas")} valor={formatarNumero(m.recebidas)} tom="sucesso" />
          <Numero rotulo={t("Média por conversa")} valor={formatarNumero(m.media_por_conversa)} />
          <Numero rotulo={t("Parte feita pela IA")} valor={formatarPct(razao(m.ia, m.enviadas))} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <MapaPorHora titulo={t("Enviadas por pessoas, por hora")} horas={d.humanas_por_hora} />
          <MapaPorHora titulo={t("Enviadas pela IA, por hora")} horas={d.ia_por_hora} cor="var(--color-info)" />
        </div>
        <div className="mt-6">
          <p className="mb-2 text-xs font-medium text-text-muted">{t("Mensagens da IA por dia")}</p>
          <GraficoPorDia serie={d.ia_por_dia} chave="total" cor={CORES[1]} altura={180} />
        </div>
      </Bloco>

      <Bloco titulo={t("Desempenho dos atendentes")} descricao={t("Quem atendeu mais no período.")}>
        <TabelaRanking
          linhas={ranking}
          nome={(l) => nomeDaLinha(l, t)}
          vazio={t("Ninguém atendeu no período escolhido.")}
          colunas={[
            { titulo: t("Conversas"), valor: (l) => formatarNumero(l.conversas) },
            { titulo: t("Mensagens"), valor: (l) => formatarNumero(l.mensagens) },
            { titulo: t("Leads"), valor: (l) => formatarNumero(l.leads) },
            { titulo: t("Vendas"), valor: (l) => formatarNumero(l.vendas) },
            { titulo: t("Conversão"), valor: (l) => formatarPct(razao(l.vendas, l.leads)) },
          ]}
        />
      </Bloco>

      <Bloco
        titulo={t("Distribuição de conversas")}
        descricao={t("Quantas conversas cada pessoa recebeu da fila no período.")}
        acao={
          filas.length > 0 ? (
            <select
              aria-label={t("Filtrar por fila")}
              value={fila}
              onChange={(e) => setFila(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="">{t("Todas as filas")}</option>
              {filas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          ) : undefined
        }
      >
        <TabelaRanking
          linhas={d.distribuicoes}
          nome={(l) => nomeDaLinha(l, t)}
          vazio={t("Nenhuma conversa foi distribuída no período.")}
          colunas={[{ titulo: t("Distribuições"), valor: (l) => formatarNumero(l.total) }]}
        />
      </Bloco>
    </div>
  );
}
