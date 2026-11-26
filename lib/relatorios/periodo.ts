/**
 * O período dos Relatórios, sempre no fuso da organização.
 * `to` é EXCLUSIVO: o fim de hoje é a meia-noite de amanhã no fuso.
 */
const MAX_DIAS = 366;
const DIA_MS = 86_400_000;

/** "YYYY-MM-DD" do instante no fuso. */
export function diaNoFuso(instante: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

function deslocamentoMs(instante: Date, tz: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** O instante da meia-noite do dia `ymd` no fuso. */
export function inicioDoDia(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const palpite = Date.UTC(y, m - 1, d);
  const primeiro = palpite - deslocamentoMs(new Date(palpite), tz);
  // Segunda passada corrige a virada de horário de verão.
  return new Date(palpite - deslocamentoMs(new Date(primeiro), tz));
}

export function somarDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DIA_MS).toISOString().slice(0, 10);
}

export function periodoPadrao(agora: Date, tz: string): { from: string; to: string } {
  const hoje = diaNoFuso(agora, tz);
  return {
    from: inicioDoDia(`${hoje.slice(0, 8)}01`, tz).toISOString(),
    to: inicioDoDia(somarDias(hoje, 1), tz).toISOString(),
  };
}

export function validarPeriodo(
  from: string | undefined,
  to: string | undefined,
  agora: Date,
  tz: string,
): { ok: true; from: Date; to: Date } | { ok: false; mensagem: string } {
  const padrao = periodoPadrao(agora, tz);
  const de = new Date(from ?? padrao.from);
  const ate = new Date(to ?? padrao.to);
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) {
    return { ok: false, mensagem: "Data inválida no período." };
  }
  if (de >= ate) return { ok: false, mensagem: "A data inicial precisa ser antes da final." };
  if (ate.getTime() - de.getTime() > MAX_DIAS * DIA_MS) {
    return { ok: false, mensagem: "O período pode ter no máximo 366 dias." };
  }
  return { ok: true, from: de, to: ate };
}
