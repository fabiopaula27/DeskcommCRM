import { describe, expect, it } from "vitest";

import { metaVsRealizadoPorDia } from "./metas";
import { gastoEstimadoUsd, TARIFA_BR_USD } from "./templates";

describe("meta diária vs realizado", () => {
  it("distribui a meta do mês por igual nos dias e acumula os dois lados", () => {
    const r = metaVsRealizadoPorDia(
      [{ periodo: "2026-11-01", alvo: 30 }],
      ["2026-11-01", "2026-11-02", "2026-11-03"],
      [{ dia: "2026-11-02", total: 2 }],
    );
    expect(r).toEqual([
      { dia: "2026-11-01", meta: 1, realizado: 0 },
      { dia: "2026-11-02", meta: 2, realizado: 2 },
      { dia: "2026-11-03", meta: 3, realizado: 2 },
    ]);
  });

  it("mês sem meta soma zero na meta", () => {
    const r = metaVsRealizadoPorDia([], ["2026-11-01"], [{ dia: "2026-11-01", total: 1 }]);
    expect(r).toEqual([{ dia: "2026-11-01", meta: 0, realizado: 1 }]);
  });

  it("fevereiro divide por 28 dias", () => {
    const r = metaVsRealizadoPorDia([{ periodo: "2026-02-01", alvo: 28 }], ["2026-02-01"], []);
    expect(r[0]!.meta).toBe(1);
  });
});

describe("gasto estimado de templates", () => {
  it("multiplica enviados pela tarifa da categoria", () => {
    expect(
      gastoEstimadoUsd([
        { categoria: "MARKETING", enviados: 10 },
        { categoria: "UTILITY", enviados: 100 },
      ]),
    ).toBeCloseTo(10 * TARIFA_BR_USD.MARKETING + 100 * TARIFA_BR_USD.UTILITY, 6);
  });

  it("categoria desconhecida não entra na conta", () => {
    expect(gastoEstimadoUsd([{ categoria: null, enviados: 50 }])).toBe(0);
  });
});
