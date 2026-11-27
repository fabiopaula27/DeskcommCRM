/**
 * O PDF do relatório, gerado no servidor (`@react-pdf/renderer`, o mesmo do
 * export de conversa). Serve ao botão "Baixar PDF" e ao envio agendado.
 * Gráficos são barras desenhadas com `View` — sem dependência de navegador.
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import type { DadosDoPdf } from "./coletar";

const COR = { texto: "#1c1a16", suave: "#5d594f", linha: "#e7e3da", fundo: "#f5f3ee", destaque: "#2f5d8a", ok: "#5a8a5f" };

const s = StyleSheet.create({
  pagina: { padding: 32, fontSize: 9, color: COR.texto, fontFamily: "Helvetica" },
  topo: { marginBottom: 14, borderBottomWidth: 1, borderBottomColor: COR.linha, paddingBottom: 10 },
  marca: { fontSize: 9, color: COR.suave },
  titulo: { fontSize: 18, fontFamily: "Helvetica-Bold", marginTop: 2 },
  sub: { fontSize: 10, color: COR.suave, marginTop: 2 },
  secao: { marginTop: 14 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  numeros: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  num: { borderWidth: 1, borderColor: COR.linha, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 8, minWidth: 90 },
  numRotulo: { fontSize: 7, color: COR.suave },
  numValor: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 1 },
  barras: { flexDirection: "row", alignItems: "flex-end", height: 60, gap: 1, marginTop: 8 },
  tabela: { marginTop: 8 },
  linha: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: COR.linha, paddingVertical: 3 },
  cab: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COR.linha, paddingBottom: 3, color: COR.suave, fontSize: 8 },
  rodape: { position: "absolute", bottom: 18, left: 32, right: 32, fontSize: 7, color: COR.suave, textAlign: "center" },
});

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("pt-BR"));
const brl = (c: number, moeda: string) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: moeda });
const usd = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : "0,0%");
const dataBr = (ymd: string) => ymd.split("-").reverse().join("/");
function duracao(sg: number | null): string {
  if (sg === null) return "—";
  if (sg < 60) return `${Math.round(sg)}s`;
  const m = Math.round(sg / 60);
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={s.num}>
      <Text style={s.numRotulo}>{rotulo}</Text>
      <Text style={s.numValor}>{valor}</Text>
    </View>
  );
}

function Barras({ serie, cor }: { serie: { total: number }[]; cor: string }) {
  const pico = Math.max(1, ...serie.map((x) => x.total));
  return (
    <View style={s.barras}>
      {serie.map((x, i) => (
        <View key={i} style={{ flex: 1, height: `${Math.max(2, (x.total / pico) * 100)}%`, backgroundColor: x.total ? cor : COR.fundo }} />
      ))}
    </View>
  );
}

function Tabela({ colunas, linhas }: { colunas: { titulo: string; largura: number }[]; linhas: string[][] }) {
  return (
    <View style={s.tabela}>
      <View style={s.cab}>
        {colunas.map((c) => (
          <Text key={c.titulo} style={{ width: `${c.largura}%` }}>{c.titulo}</Text>
        ))}
      </View>
      {linhas.map((l, i) => (
        <View key={i} style={s.linha} wrap={false}>
          {l.map((v, j) => (
            <Text key={j} style={{ width: `${colunas[j]?.largura ?? 10}%` }}>{v}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Relatorio({ d, empresa, sistema, moeda }: { d: DadosDoPdf; empresa: string; sistema: string; moeda: string }) {
  const a = d.atendimento;
  const l = d.leads;
  return (
    <Document title={`Relatório ${empresa}`}>
      <Page size="A4" style={s.pagina}>
        <View style={s.topo}>
          <Text style={s.marca}>{sistema}</Text>
          <Text style={s.titulo}>Relatório · {empresa}</Text>
          <Text style={s.sub}>
            {d.periodo.de === d.periodo.ate ? dataBr(d.periodo.de) : `${dataBr(d.periodo.de)} a ${dataBr(d.periodo.ate)}`}
          </Text>
        </View>

        {a ? (
          <View style={s.secao}>
            <Text style={s.h2}>Atendimento</Text>
            <View style={s.numeros}>
              <Numero rotulo="Conversas" valor={n(a.conversas)} />
              <Numero rotulo="Ativas" valor={n(a.ativas)} />
              <Numero rotulo="IA pausada" valor={n(a.pausadas)} />
              <Numero rotulo="1ª resposta (mediana)" valor={duracao(a.primeira_resposta_s)} />
              <Numero rotulo="Mensagens enviadas" valor={n(a.enviadas)} />
              <Numero rotulo="Enviadas pela IA" valor={n(a.enviadas_ia)} />
              <Numero rotulo="Recebidas" valor={n(a.recebidas)} />
            </View>
            {a.por_dia.length > 1 ? <Barras serie={a.por_dia} cor={COR.destaque} /> : null}
            {a.atendentes.length > 0 ? (
              <Tabela
                colunas={[{ titulo: "Atendente", largura: 46 }, { titulo: "Conversas", largura: 18 }, { titulo: "Mensagens", largura: 18 }, { titulo: "Vendas", largura: 18 }]}
                linhas={a.atendentes.map((x) => [x.nome, n(x.conversas), n(x.mensagens), n(x.vendas)])}
              />
            ) : null}
          </View>
        ) : null}

        {l ? (
          <View style={s.secao} wrap={false}>
            <Text style={s.h2}>Leads e vendas</Text>
            <View style={s.numeros}>
              <Numero rotulo="Leads" valor={n(l.leads)} />
              <Numero rotulo="Viraram venda" valor={n(l.convertidos)} />
              <Numero rotulo="Conversão" valor={pct(l.convertidos, l.leads)} />
              <Numero rotulo="Vendas" valor={n(l.vendas)} />
              <Numero rotulo="Receita" valor={brl(l.receita_cents, moeda)} />
              <Numero rotulo="Ticket médio" valor={brl(l.vendas > 0 ? l.receita_cents / l.vendas : 0, moeda)} />
            </View>
            {l.por_dia.length > 1 ? <Barras serie={l.por_dia} cor={COR.ok} /> : null}
            {l.origens.length > 0 ? (
              <Text style={{ marginTop: 6, color: COR.suave }}>
                Origens: {l.origens.slice(0, 6).map((o) => `${o.rotulo} (${n(o.total)})`).join(" · ")}
              </Text>
            ) : null}
            {l.vendedores.length > 0 ? (
              <Tabela
                colunas={[{ titulo: "Vendedor", largura: 46 }, { titulo: "Leads", largura: 16 }, { titulo: "Vendas", largura: 16 }, { titulo: "Receita", largura: 22 }]}
                linhas={l.vendedores.map((x) => [x.nome, n(x.leads), n(x.vendas), brl(x.receita_cents, moeda)])}
              />
            ) : null}
          </View>
        ) : null}

        {d.funil && d.funil.funis.length > 0 ? (
          <View style={s.secao} wrap={false}>
            <Text style={s.h2}>Funil</Text>
            <Tabela
              colunas={[{ titulo: "Funil", largura: 60 }, { titulo: "Leads", largura: 15 }, { titulo: "Valor", largura: 25 }]}
              linhas={d.funil.funis.map((f) => [f.nome, n(f.leads), brl(f.valor_cents, moeda)])}
            />
          </View>
        ) : null}

        {d.metas ? (
          <View style={s.secao} wrap={false}>
            <Text style={s.h2}>Metas e produtos</Text>
            <View style={s.numeros}>
              <Numero rotulo="Meta de vendas" valor={d.metas.alvo > 0 ? n(d.metas.alvo) : "sem meta"} />
              <Numero rotulo="Vendas realizadas" valor={n(d.metas.realizado)} />
              <Numero rotulo="Atingimento" valor={d.metas.alvo > 0 ? pct(d.metas.realizado, d.metas.alvo) : "—"} />
              <Numero rotulo="Itens vendidos" valor={n(d.metas.produtos_itens)} />
              <Numero rotulo="Receita de produtos" valor={brl(d.metas.produtos_receita_cents, moeda)} />
            </View>
            {d.metas.top_produtos.length > 0 ? (
              <Tabela
                colunas={[{ titulo: "Produto", largura: 60 }, { titulo: "Qtd", largura: 15 }, { titulo: "Receita", largura: 25 }]}
                linhas={d.metas.top_produtos.map((p) => [p.nome, n(p.quantidade), brl(p.receita_cents, moeda)])}
              />
            ) : null}
          </View>
        ) : null}

        {d.templates || d.ia ? (
          <View style={s.secao} wrap={false}>
            <Text style={s.h2}>Templates e IA</Text>
            <View style={s.numeros}>
              {d.templates ? <Numero rotulo="Templates enviados" valor={n(d.templates.enviados)} /> : null}
              {d.templates ? <Numero rotulo="Taxa de resposta" valor={pct(d.templates.respondidos, d.templates.enviados)} /> : null}
              {d.templates ? <Numero rotulo="Gasto estimado (templates)" valor={`≈ ${usd(d.templates.gasto_usd)}`} /> : null}
              {d.ia ? <Numero rotulo="Tokens de IA" valor={n(d.ia.tokens)} /> : null}
              {d.ia ? <Numero rotulo="Atendimentos da IA" valor={n(d.ia.turnos)} /> : null}
              {d.ia ? <Numero rotulo="Custo estimado (IA)" valor={usd(d.ia.custo_cents / 100)} /> : null}
            </View>
          </View>
        ) : null}

        <Text style={s.rodape} render={({ pageNumber, totalPages }) => `${sistema} · página ${pageNumber} de ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

export async function gerarPdfDoRelatorio(
  dados: DadosDoPdf,
  opcoes: { empresa: string; sistema: string; moeda: string },
): Promise<Buffer> {
  return renderToBuffer(<Relatorio d={dados} empresa={opcoes.empresa} sistema={opcoes.sistema} moeda={opcoes.moeda} />);
}
