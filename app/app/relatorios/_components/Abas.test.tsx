import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
// recharts precisa de medidas reais do DOM; nos testes o gráfico vira uma marca.
vi.mock("recharts", async () => {
  const React = await import("react");
  const Falso = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Falso, AreaChart: Falso, Area: () => null, CartesianGrid: () => null,
    XAxis: () => null, YAxis: () => null, Tooltip: () => null, PieChart: Falso, Pie: Falso, Cell: () => null,
    BarChart: Falso, Bar: () => null,
  };
});

const useRelatorio = vi.fn();
vi.mock("@/hooks/relatorios/useRelatorio", () => ({ useRelatorio: (...a: unknown[]) => useRelatorio(...a) }));

import { AbaAtendimento } from "./AbaAtendimento";
import { AbaFunil } from "./AbaFunil";
import { AbaLeadsEVendas } from "./AbaLeadsEVendas";

const filtros = { from: "2026-11-01T03:00:00.000Z", to: "2026-11-27T03:00:00.000Z" };
const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, total: hora === 10 ? 5 : 0 }));

function responde(data: unknown) {
  useRelatorio.mockReturnValue({ data: { data }, isLoading: false, isError: false });
}

beforeEach(() => useRelatorio.mockReset());

describe("AbaAtendimento", () => {
  const base = {
    disponivel: true,
    cartoes: {
      conversas: { hoje: 7, ontem: 18, trinta_dias: 158, variacao: { tipo: "pct", pct: -61.1 } },
      leads: { hoje: 3, ontem: 9, trinta_dias: 119, variacao: { tipo: "pct", pct: -66.7 } },
      vendas: { hoje: 0, ontem: 0, trinta_dias: 0, variacao: { tipo: "igual" } },
      receita_cents: { hoje: 0, ontem: 0, trinta_dias: 0, variacao: { tipo: "igual" } },
    },
    conversas_por_dia: [{ dia: "2026-11-01", total: 2 }],
    conversas_resumo: { total: 136, ativas: 1, pausadas: 135, tempo_medio_atendimento_s: null, tempo_primeira_resposta_s: 180 },
    por_canal: [{ canal: "whatsapp", total: 1143 }],
    mensagens: { enviadas: 669, humanas: 669, ia: 0, recebidas: 351, media_por_conversa: 7.5 },
    humanas_por_hora: horas,
    ia_por_hora: horas,
    ia_por_dia: [],
    atendentes: [
      { user_id: "b", nome: "George", email: "g@x", conversas: 23, mensagens: 50, leads: 25, vendas: 0 },
      { user_id: "a", nome: "Lici", email: "l@x", conversas: 25, mensagens: 159, leads: 25, vendas: 0 },
    ],
    distribuicoes: [],
  };

  it("cartão de conversas mostra hoje e a variação", () => {
    responde(base);
    render(<AbaAtendimento filtros={filtros} moeda="BRL" pessoas={[]} />);
    const cartao = screen.getByText("Conversas hoje").parentElement!;
    expect(within(cartao).getByText("7")).toBeTruthy();
    expect(within(cartao).getByText(/61,1%/)).toBeTruthy();
  });

  it("mapa por hora tem 24 células", () => {
    responde(base);
    render(<AbaAtendimento filtros={filtros} moeda="BRL" pessoas={[]} />);
    const mapa = screen.getAllByTestId("mapa-por-hora")[0]!;
    expect(mapa.children).toHaveLength(24);
  });

  it("ranking ordena por conversas", () => {
    responde(base);
    render(<AbaAtendimento filtros={filtros} moeda="BRL" pessoas={[]} />);
    const nomes = screen.getAllByText(/^(Lici|George)$/).map((n) => n.textContent);
    expect(nomes[0]).toBe("Lici");
  });

  it("com filas cadastradas mostra o seletor de fila", () => {
    responde(base);
    render(<AbaAtendimento filtros={filtros} moeda="BRL" pessoas={[]} filas={[{ id: "s1", nome: "atendimento-Vendas" }]} />);
    expect(screen.getByLabelText("Filtrar por fila")).toBeTruthy();
    expect(useRelatorio).toHaveBeenCalled();
  });

  it("sem a migration mostra o aviso", () => {
    responde({ disponivel: false, motivo: "aplique a migration" });
    render(<AbaAtendimento filtros={filtros} moeda="BRL" pessoas={[]} />);
    expect(screen.getByText("aplique a migration")).toBeTruthy();
  });
});

describe("AbaLeadsEVendas", () => {
  const base = {
    disponivel: true,
    leads_total: 0,
    convertidos: 0,
    leads_por_dia: [],
    origens: [],
    vendas_total: 0,
    receita_cents: 0,
    vendas_por_dia: [
      { dia: "2026-11-01", total: 1, receita_cents: 5000 },
      { dia: "2026-11-02", total: 2, receita_cents: 90000 },
      { dia: "2026-11-03", total: 1, receita_cents: 10000 },
      { dia: "2026-11-04", total: 0, receita_cents: 0 },
    ],
    vendedores: [],
  };

  it("taxa de conversão e ticket médio sem NaN quando não há dados", () => {
    responde(base);
    render(<AbaLeadsEVendas filtros={filtros} moeda="BRL" pessoas={[]} />);
    expect(screen.getAllByText("0,0%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("melhores dias lista os 3 de maior receita", () => {
    responde(base);
    render(<AbaLeadsEVendas filtros={filtros} moeda="BRL" pessoas={[]} />);
    const lista = screen.getByTestId("melhores-dias");
    expect(lista.children).toHaveLength(3);
    expect(lista.children[0]!.textContent).toMatch(/02 nov/);
  });
});

describe("AbaFunil", () => {
  it("lista os funis com a parte de cada um no total", () => {
    responde({
      disponivel: true,
      funis: [
        { pipeline_id: "p1", nome: "Geral", posicao: 0, leads: 75, valor_cents: 0 },
        { pipeline_id: "p2", nome: "Campanha", posicao: 1, leads: 25, valor_cents: 0 },
      ],
      etapas: [],
    });
    render(<AbaFunil filtros={filtros} moeda="BRL" funis={[]} />);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
  });
});

describe("impressão das tabelas", () => {
  it("todas as linhas do ranking existem no documento (as de outras páginas só aparecem na impressão)", () => {
    const atendentes = Array.from({ length: 12 }, (_, i) => ({
      user_id: `u${i}`, nome: `Pessoa ${i}`, email: null, conversas: 100 - i, mensagens: 0, leads: 0, vendas: 0,
    }));
    useRelatorio.mockReturnValue({
      data: { data: {
        disponivel: true,
        cartoes: {
          conversas: { hoje: 0, ontem: 0, trinta_dias: 0, variacao: { tipo: "igual" } },
          leads: { hoje: 0, ontem: 0, trinta_dias: 0, variacao: { tipo: "igual" } },
          vendas: { hoje: 0, ontem: 0, trinta_dias: 0, variacao: { tipo: "igual" } },
          receita_cents: { hoje: 0, ontem: 0, trinta_dias: 0, variacao: { tipo: "igual" } },
        },
        conversas_por_dia: [], conversas_resumo: { total: 0, ativas: 0, pausadas: 0, tempo_medio_atendimento_s: null, tempo_primeira_resposta_s: null },
        por_canal: [], mensagens: { enviadas: 0, humanas: 0, ia: 0, recebidas: 0, media_por_conversa: null },
        humanas_por_hora: horas, ia_por_hora: horas, ia_por_dia: [], atendentes, distribuicoes: [],
      } }, isLoading: false, isError: false,
    });
    render(<AbaAtendimento filtros={filtros} moeda="BRL" pessoas={[]} />);
    expect(screen.getByText("Pessoa 11").closest("tr")!.className).toMatch(/print:table-row/);
  });
});
