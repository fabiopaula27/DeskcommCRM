/**
 * Uma rodada do envio agendado (o cron chama a cada 15 min): para cada
 * empresa com agendamento ligado, decide no relógio DELA se é hora, envia e
 * grava o desfecho. Uma empresa com defeito não derruba as outras.
 */
import { envioDevido, periodoDoEnvio, TENTATIVAS_POR_PERIODO, type Frequencia, type PeriodoDoEnvio } from "./agendamento";

export type LinhaDoAgendamento = {
  organization_id: string;
  ativo: boolean;
  frequencia: Frequencia;
  horario: string;
  emails: string[];
  telefones: string[];
  channel_session_id: string | null;
  ultimo_periodo: string | null;
  tentativas_do_periodo: number;
  telefones_pendentes?: string[];
};

export type Desfecho = {
  ultimo_periodo: string;
  tentativas_do_periodo?: number;
  telefones_pendentes?: string[];
  ultimo_erro: string | null;
  ultimo_envio_em?: string;
};

type Resultado = { enviado: boolean; falhas: string[]; telefonesComFalha?: string[] };

/** Telefone que falhou no período já enviado: nova tentativa, só para ele. */
function reenvioDevido(l: LinhaDoAgendamento, agora: Date, tz: string): PeriodoDoEnvio | null {
  if (!l.ativo || (l.telefones_pendentes ?? []).length === 0) return null;
  if (l.tentativas_do_periodo >= TENTATIVAS_POR_PERIODO) return null;
  const periodo = periodoDoEnvio(l.frequencia, agora, tz);
  return l.ultimo_periodo === periodo.chave ? periodo : null;
}

export async function rodarEnviosAgendados(args: {
  agendamentos: LinhaDoAgendamento[];
  paradas: Set<string>;
  fusoDe: (orgId: string) => Promise<string>;
  enviar: (linha: LinhaDoAgendamento, periodo: PeriodoDoEnvio, tz: string) => Promise<Resultado>;
  gravar: (orgId: string, desfecho: Desfecho) => Promise<void>;
  /** Reserva o período no banco ANTES de enviar; `false` = outra rodada já pegou. */
  reservar: (orgId: string, chave: string) => Promise<boolean>;
  /** Reserva a NOVA TENTATIVA dos telefones pendentes; devolve a lista ou `null`. */
  reservarReenvio: (orgId: string, chave: string) => Promise<string[] | null>;
  agora: Date;
  /** Tempo da rodada: passou dele, não pega empresa nova (a próxima rodada segue). */
  prazoMs?: number;
  decorrido?: () => number;
}): Promise<{ enviados: number; falhas: number; pulados: number }> {
  const inicio = Date.now();
  const decorrido = args.decorrido ?? (() => Date.now() - inicio);
  let enviados = 0;
  let falhas = 0;
  let pulados = 0;

  for (const linha of args.agendamentos) {
    if (args.prazoMs !== undefined && decorrido() >= args.prazoMs) break;
    if (args.paradas.has(linha.organization_id)) {
      pulados += 1;
      continue;
    }
    const tz = await args.fusoDe(linha.organization_id);
    const periodo = envioDevido(linha, args.agora, tz);
    if (!periodo) {
      const reenvio = reenvioDevido(linha, args.agora, tz);
      if (!reenvio) continue;
      const reservados = await args.reservarReenvio(linha.organization_id, reenvio.chave);
      // Só quem ainda está na lista: telefone removido depois da falha não recebe.
      const pendentes = (reservados ?? []).filter((t) => linha.telefones.includes(t));
      if (pendentes.length === 0) continue;
      let r: Resultado;
      try {
        r = await args.enviar({ ...linha, emails: [], telefones: pendentes }, reenvio, tz);
      } catch (e) {
        r = { enviado: false, falhas: [e instanceof Error ? e.message : String(e)], telefonesComFalha: pendentes };
      }
      if (r.enviado) enviados += 1;
      else falhas += 1;
      await args.gravar(linha.organization_id, {
        ultimo_periodo: reenvio.chave,
        telefones_pendentes: r.telefonesComFalha ?? [],
        ultimo_erro: r.falhas.length > 0 ? r.falhas.join(" · ") : null,
      });
      continue;
    }

    if (!(await args.reservar(linha.organization_id, periodo.chave))) continue;

    const tentativaAnterior =
      linha.ultimo_periodo === `falhou:${periodo.chave}` ? linha.tentativas_do_periodo : 0;
    let resultado: Resultado;
    try {
      resultado = await args.enviar(linha, periodo, tz);
    } catch (e) {
      resultado = { enviado: false, falhas: [e instanceof Error ? e.message : String(e)] };
    }

    if (resultado.enviado) {
      enviados += 1;
      await args.gravar(linha.organization_id, {
        ultimo_periodo: periodo.chave,
        tentativas_do_periodo: 0,
        telefones_pendentes: resultado.telefonesComFalha ?? [],
        // Envio parcial (um destino falhou) conta como enviado: repetir mandaria
        // de novo a quem já recebeu. O que falhou fica escrito para a tela.
        ultimo_erro: resultado.falhas.length > 0 ? resultado.falhas.join(" · ") : null,
        ultimo_envio_em: args.agora.toISOString(),
      });
    } else {
      falhas += 1;
      await args.gravar(linha.organization_id, {
        ultimo_periodo: `falhou:${periodo.chave}`,
        tentativas_do_periodo: tentativaAnterior + 1,
        ultimo_erro: resultado.falhas.join(" · ") || "falhou",
      });
    }
  }
  return { enviados, falhas, pulados };
}
