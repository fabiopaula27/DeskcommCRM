import { describe, expect, it } from "vitest";

import { periodoPadrao, validarPeriodo } from "./periodo";
import { preencherDias, preencherHoras, variacao } from "./series";

describe("séries do relatório", () => {
  it("preenche dias vazios com zero", () => {
    const r = preencherDias(
      [{ dia: "2026-11-03", total: 5 }],
      new Date("2026-11-01T03:00:00Z"),
      new Date("2026-11-04T02:59:59Z"),
      "America/Sao_Paulo",
      (dia) => ({ dia, total: 0 }),
    );
    expect(r.map((x) => x.dia)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(r.map((x) => x.total)).toEqual([0, 0, 5]);
  });
  it("variacao com ontem zero é 'novo'", () => expect(variacao(3, 0)).toEqual({ tipo: "novo" }));
  it("variacao -61.1%", () => expect(variacao(7, 18)).toEqual({ tipo: "pct", pct: -61.1 }));
  it("variacao igual", () => expect(variacao(0, 0)).toEqual({ tipo: "igual" }));
  it("24 horas sempre", () => {
    const r = preencherHoras([{ hora: 10, total: 4 }]);
    expect(r).toHaveLength(24);
    expect(r[10]).toEqual({ hora: 10, total: 4 });
    expect(r[0]).toEqual({ hora: 0, total: 0 });
  });
});

describe("período do relatório", () => {
  const agora = new Date("2026-11-26T15:00:00Z");
  it("padrão é do dia 1 do mês até o fim de hoje, no fuso", () => {
    const p = periodoPadrao(agora, "America/Sao_Paulo");
    expect(p.from).toBe("2026-11-01T03:00:00.000Z");
    expect(p.to).toBe("2026-11-27T03:00:00.000Z");
  });
  it("recusa from depois de to", () =>
    expect(validarPeriodo("2026-11-10T00:00:00Z", "2026-11-01T00:00:00Z", agora, "UTC").ok).toBe(false));
  it("recusa mais de 366 dias", () =>
    expect(validarPeriodo("2025-01-01T00:00:00Z", "2026-11-01T00:00:00Z", agora, "UTC").ok).toBe(false));
  it("recusa data inválida", () => expect(validarPeriodo("ontem", undefined, agora, "UTC").ok).toBe(false));
  it("sem datas usa o padrão", () => {
    const v = validarPeriodo(undefined, undefined, agora, "America/Sao_Paulo");
    expect(v.ok && v.from.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});
