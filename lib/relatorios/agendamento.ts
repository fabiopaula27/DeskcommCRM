/**
 * Quando o relatório agendado sai e qual período ele cobre — no relógio da
 * organização. Diário: ontem. Semanal (toda segunda): a semana anterior, de
 * segunda a domingo. Mensal (todo dia 1): o mês anterior inteiro.
 *
 * `ultimo_periodo` guarda a chave do período já enviado (não repete) ou
 * `falhou:<chave>` com o número de tentativas: depois de 2 falhas o período é
 * deixado de lado e o erro fica registrado na tela.
 */
import { diaNoFuso, inicioDoDia, somarDias } from "./periodo";

export type Frequencia = "diario" | "semanal" | "mensal";

export type PeriodoDoEnvio = {
  chave: string;
  de: string;
  ate: string;
  from: string;
  to: string;
};

export const TENTATIVAS_POR_PERIODO = 2;

function diaDaSemana(ymd: string): number {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}

function horaLocal(agora: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
}

export function periodoDoEnvio(frequencia: Frequencia, agora: Date, tz: string): PeriodoDoEnvio {
  const hoje = diaNoFuso(agora, tz);
  let de: string;
  let ate: string;
  let chave: string;
  if (frequencia === "diario") {
    de = ate = somarDias(hoje, -1);
    chave = `diario:${de}`;
  } else if (frequencia === "semanal") {
    const recuoAteSegunda = (diaDaSemana(hoje) + 6) % 7; // segunda = 0
    const segundaDestaSemana = somarDias(hoje, -recuoAteSegunda);
    de = somarDias(segundaDestaSemana, -7);
    ate = somarDias(segundaDestaSemana, -1);
    chave = `semanal:${de}`;
  } else {
    const primeiroDesteMes = `${hoje.slice(0, 8)}01`;
    ate = somarDias(primeiroDesteMes, -1);
    de = `${ate.slice(0, 8)}01`;
    chave = `mensal:${de.slice(0, 7)}`;
  }
  return {
    chave,
    de,
    ate,
    from: inicioDoDia(de, tz).toISOString(),
    to: inicioDoDia(somarDias(ate, 1), tz).toISOString(),
  };
}

export type AgendamentoParaDecidir = {
  ativo: boolean;
  frequencia: Frequencia;
  horario: string;
  ultimo_periodo: string | null;
  tentativas_do_periodo: number;
};

/** O período a enviar agora, ou `null` se não é hora (ou já foi). */
export function envioDevido(a: AgendamentoParaDecidir, agora: Date, tz: string): PeriodoDoEnvio | null {
  if (!a.ativo) return null;
  const hoje = diaNoFuso(agora, tz);
  if (a.frequencia === "semanal" && diaDaSemana(hoje) !== 1) return null;
  if (a.frequencia === "mensal" && !hoje.endsWith("-01")) return null;
  if (horaLocal(agora, tz) < a.horario.slice(0, 5)) return null;

  const periodo = periodoDoEnvio(a.frequencia, agora, tz);
  if (a.ultimo_periodo === periodo.chave) return null;
  if (a.ultimo_periodo === `falhou:${periodo.chave}` && a.tentativas_do_periodo >= TENTATIVAS_POR_PERIODO) {
    return null;
  }
  return periodo;
}
