import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (chave: string) => chave }));
vi.mock("recharts", async () => {
  const React = await import("react");
  const Falso = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Falso, AreaChart: Falso, Area: () => null, LineChart: Falso, Line: () => null,
    CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
    PieChart: Falso, Pie: Falso, Cell: () => null,
  };
});
const useRelatorio = vi.fn();
vi.mock("@/hooks/relatorios/useRelatorio", () => ({ useRelatorio: (...a: unknown[]) => useRelatorio(...a) }));

import { AbaIA } from "./AbaIA";

const filtros = { from: "2026-11-01T03:00:00.000Z", to: "2026-11-27T03:00:00.000Z" };
function responde(data: unknown) {
  useRelatorio.mockReturnValue({ data: { data }, isLoading: false, isError: false });
}
beforeEach(() => useRelatorio.mockReset());

describe("AbaIA", () => {
  it("mostra tokens, custo e o histórico por mês", () => {
    responde({
      disponivel: true, tokens: 1234567, tokens_entrada: 1000000, tokens_saida: 200000, tokens_cache: 34567,
      custo_cents: 1250, chamadas: 900, turnos: 300, custo_por_turno_cents: 4,
      por_uso: [{ uso: "Atendimento da IA", tokens: 1000000, custo_cents: 1000, chamadas: 600 }],
      por_dia: [], historico: [{ mes: "2026-10", tokens: 10, custo_cents: 1, chamadas: 1 }, { mes: "2026-11", tokens: 20, custo_cents: 2, chamadas: 2 }],
    });
    render(<AbaIA filtros={filtros} />);
    expect(screen.getByText("1.234.567")).toBeTruthy();
    expect(screen.getAllByText(/US\$\s?12,50/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("historico-ia").children).toHaveLength(2);
  });

  it("sem uso mostra mensagem e custo por turno vazio", () => {
    responde({
      disponivel: true, tokens: 0, tokens_entrada: 0, tokens_saida: 0, tokens_cache: 0, custo_cents: 0,
      chamadas: 0, turnos: 0, custo_por_turno_cents: null, por_uso: [], por_dia: [], historico: [],
    });
    render(<AbaIA filtros={filtros} />);
    expect(screen.getByText("A IA não foi usada no período.")).toBeTruthy();
  });
});
