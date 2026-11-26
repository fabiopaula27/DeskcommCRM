import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("recharts", async () => {
  const React = await import("react");
  const Falso = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Falso, AreaChart: Falso, Area: () => null, LineChart: Falso, Line: () => null,
    ComposedChart: Falso, Bar: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
    Tooltip: () => null, Legend: () => null, PieChart: Falso, Pie: Falso, Cell: () => null,
  };
});

const useRelatorio = vi.fn();
vi.mock("@/hooks/relatorios/useRelatorio", () => ({ useRelatorio: (...a: unknown[]) => useRelatorio(...a) }));

import { AbaMetasEProdutos } from "./AbaMetasEProdutos";
import { AbaTemplates } from "./AbaTemplates";

const filtros = { from: "2026-11-01T03:00:00.000Z", to: "2026-11-27T03:00:00.000Z" };
const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0 }));
function responde(data: unknown) {
  useRelatorio.mockReturnValue({ data: { data }, isLoading: false, isError: false });
}
beforeEach(() => useRelatorio.mockReset());

const produtosVazios = {
  produtos_distintos: 0, itens_vendidos: 0, receita_cents: 0, descontos_cents: 0,
  por_dia: [], por_hora: horas, top_produtos: [], por_vendedor: [],
};

describe("AbaMetasEProdutos", () => {
  it("atingimento = realizado / meta", () => {
    responde({
      disponivel: true,
      metas: { metas_total: 1, alvo: 40, realizado: 10, receita_cents: 0, meta_vs_realizado: [], por_funil: [], por_vendedor: [] },
      produtos: produtosVazios,
    });
    render(<AbaMetasEProdutos filtros={filtros} moeda="BRL" pessoas={[]} />);
    expect(screen.getAllByText("25,0%").length).toBeGreaterThan(0);
  });

  it("sem meta cadastrada explica onde cadastrar, sem mostrar 0%", () => {
    responde({
      disponivel: true,
      metas: { metas_total: 0, alvo: 0, realizado: 3, receita_cents: 0, meta_vs_realizado: [], por_funil: [], por_vendedor: [] },
      produtos: produtosVazios,
    });
    render(<AbaMetasEProdutos filtros={filtros} moeda="BRL" pessoas={[]} />);
    expect(screen.getByText(/Nenhuma meta cadastrada/)).toBeTruthy();
  });
});

describe("AbaMetasEProdutos com vendedor escolhido", () => {
  it("não compara o vendedor com a meta da empresa", async () => {
    const { fireEvent } = await import("@testing-library/react");
    responde({
      disponivel: true,
      metas: { metas_total: 1, alvo: 40, realizado: 10, receita_cents: 0, meta_vs_realizado: [], por_funil: [], por_vendedor: [] },
      produtos: produtosVazios,
    });
    render(<AbaMetasEProdutos filtros={filtros} moeda="BRL" pessoas={[{ user_id: "u1", nome: "Ana" }]} />);
    fireEvent.change(screen.getByLabelText("Filtrar por vendedor"), { target: { value: "u1" } });
    expect(screen.queryByText("25,0%")).toBeNull();
    expect(screen.getByText(/A meta é da empresa/)).toBeTruthy();
  });
});

describe("AbaTemplates", () => {
  it("taxa de resposta e gasto estimado", () => {
    responde({
      disponivel: true, enviados: 10, respondidos: 4, gasto_estimado_usd: 0.625, por_dia: [],
      por_template: [{ nome: "boas_vindas", categoria: "MARKETING", enviados: 10, respondidos: 4, gasto_estimado_usd: 0.625 }],
      nomes: ["boas_vindas"],
    });
    render(<AbaTemplates filtros={filtros} />);
    expect(screen.getAllByText("40,0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/US\$\s?0,63/).length).toBeGreaterThan(0);
  });

  it("período sem envios mostra mensagem", () => {
    responde({ disponivel: true, enviados: 0, respondidos: 0, gasto_estimado_usd: 0, por_dia: [], por_template: [], nomes: [] });
    render(<AbaTemplates filtros={filtros} />);
    expect(screen.getByText("Nenhum template foi enviado no período.")).toBeTruthy();
  });
});
