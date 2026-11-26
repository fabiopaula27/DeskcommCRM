/** Formatação compartilhada pelos blocos dos Relatórios. */
export function formatarNumero(n: number | null | undefined, idioma = "pt-BR"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString(idioma);
}

export function formatarMoeda(cents: number | null | undefined, moeda = "BRL", idioma = "pt-BR"): string {
  const valor = (cents ?? 0) / 100;
  return valor.toLocaleString(idioma, { style: "currency", currency: moeda });
}

export function formatarPct(fracao: number | null, idioma = "pt-BR"): string {
  if (fracao === null || !Number.isFinite(fracao)) return "—";
  return `${(fracao * 100).toLocaleString(idioma, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Divide sem NaN: denominador zero vira 0. */
export function razao(numerador: number, denominador: number): number {
  return denominador > 0 ? numerador / denominador : 0;
}

export function formatarDuracao(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined) return "—";
  if (segundos < 60) return `${Math.round(segundos)}s`;
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, "0")}`;
}

/** "2026-11-03" → "03 nov" */
export function rotuloDoDia(dia: string, idioma = "pt-BR"): string {
  const d = new Date(`${dia}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return dia;
  return d.toLocaleDateString(idioma, { day: "2-digit", month: "short", timeZone: "UTC" }).replace(" de ", " ").replace(".", "");
}

/** As cores dos gráficos, na ordem em que as séries aparecem. Tokens do tema. */
export const CORES = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-error)",
  "var(--color-text-subtle)",
];
