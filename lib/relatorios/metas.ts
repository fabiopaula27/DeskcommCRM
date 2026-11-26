/**
 * Meta do mês (quantidade de vendas ganhas, `crm_metas`) espalhada por igual
 * nos dias do mês, acumulada lado a lado com o realizado — a linha que mostra
 * se a empresa está à frente ou atrás do ritmo.
 */
function diasNoMes(ymd: string): number {
  const [y = 1970, m = 1] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function metaVsRealizadoPorDia(
  meses: readonly { periodo: string; alvo: number }[],
  dias: readonly string[],
  realizadoPorDia: readonly { dia: string; total: number }[],
): { dia: string; meta: number; realizado: number }[] {
  const alvoDoMes = new Map(meses.map((m) => [m.periodo.slice(0, 7), m.alvo]));
  const realizado = new Map(realizadoPorDia.map((r) => [r.dia, r.total]));
  let metaAcum = 0;
  let realAcum = 0;
  return dias.map((dia) => {
    const alvo = alvoDoMes.get(dia.slice(0, 7)) ?? 0;
    metaAcum += alvo / diasNoMes(dia);
    realAcum += realizado.get(dia) ?? 0;
    return { dia, meta: Math.round(metaAcum * 100) / 100, realizado: realAcum };
  });
}
