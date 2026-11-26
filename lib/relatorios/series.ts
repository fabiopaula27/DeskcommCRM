import { diaNoFuso, somarDias } from "./periodo";

/** Um item por dia do período (de `from` até antes de `to`), com zero onde não houve dado. */
export function preencherDias<T extends { dia: string }>(
  serie: readonly T[],
  from: Date,
  to: Date,
  tz: string,
  vazio: (dia: string) => T,
): T[] {
  const porDia = new Map(serie.map((s) => [s.dia, s]));
  const ultimo = diaNoFuso(new Date(to.getTime() - 1), tz);
  const saida: T[] = [];
  for (let dia = diaNoFuso(from, tz); dia <= ultimo; dia = somarDias(dia, 1)) {
    saida.push(porDia.get(dia) ?? vazio(dia));
  }
  return saida;
}

export function preencherHoras(
  serie: readonly { hora: number; total: number }[],
): { hora: number; total: number }[] {
  const porHora = new Map(serie.map((s) => [s.hora, s.total]));
  return Array.from({ length: 24 }, (_, hora) => ({ hora, total: porHora.get(hora) ?? 0 }));
}

export type Variacao = { tipo: "novo" } | { tipo: "igual" } | { tipo: "pct"; pct: number };

export function variacao(hoje: number, ontem: number): Variacao {
  if (hoje === ontem) return { tipo: "igual" };
  if (ontem === 0) return { tipo: "novo" };
  return { tipo: "pct", pct: Math.round(((hoje - ontem) / ontem) * 1000) / 10 };
}
