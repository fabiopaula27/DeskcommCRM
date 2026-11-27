import { describe, expect, it } from "vitest";

import { rotuloDoUso, somarPorMes, tokensDe } from "./ia";

describe("consumo de IA", () => {
  it("tokens somam entrada, saída e cache", () => {
    expect(tokensDe({ input_tokens: 10, output_tokens: 5, cache_read_tokens: 3, cache_write_tokens: 2 })).toBe(20);
  });

  it("agrupa os dias por mês, em ordem", () => {
    const r = somarPorMes([
      { dia: "2026-10-31", custo_cents: 10, input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, chamadas: 1 },
      { dia: "2026-11-01", custo_cents: 5, input_tokens: 50, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, chamadas: 2 },
      { dia: "2026-11-02", custo_cents: 5, input_tokens: 40, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, chamadas: 1 },
    ]);
    expect(r).toEqual([
      { mes: "2026-10", tokens: 100, custo_cents: 10, chamadas: 1 },
      { mes: "2026-11", tokens: 100, custo_cents: 10, chamadas: 3 },
    ]);
  });

  it("uso conhecido ganha nome em português; desconhecido mostra o código", () => {
    expect(rotuloDoUso("agent_turn")).toBe("Atendimento da IA");
    expect(rotuloDoUso("algo_novo")).toBe("algo_novo");
  });
});
