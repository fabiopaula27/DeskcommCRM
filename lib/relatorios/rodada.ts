/**
 * Uma rodada do envio agendado (o cron chama a cada 15 min): para cada
 * empresa com agendamento ligado, decide no relógio DELA se é hora, envia e
 * grava o desfecho. Uma empresa com defeito não derruba as outras.
 */
import { envioDevido, type Frequencia, type PeriodoDoEnvio } from "./agendamento";

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
};

export type Desfecho = {
  ultimo_periodo: string;
  tentativas_do_periodo: number;
  ultimo_erro: string | null;
  ultimo_envio_em?: string;
};

export async function rodarEnviosAgendados(args: {
  agendamentos: LinhaDoAgendamento[];
  paradas: Set<string>;
  fusoDe: (orgId: string) => Promise<string>;
  enviar: (linha: LinhaDoAgendamento, periodo: PeriodoDoEnvio, tz: string) => Promise<{ enviado: boolean; falhas: string[] }>;
  gravar: (orgId: string, desfecho: Desfecho) => Promise<void>;
  agora: Date;
}): Promise<{ enviados: number; falhas: number; pulados: number }> {
  let enviados = 0;
  let falhas = 0;
  let pulados = 0;

  for (const linha of args.agendamentos) {
    if (args.paradas.has(linha.organization_id)) {
      pulados += 1;
      continue;
    }
    const tz = await args.fusoDe(linha.organization_id);
    const periodo = envioDevido(linha, args.agora, tz);
    if (!periodo) continue;

    const tentativaAnterior =
      linha.ultimo_periodo === `falhou:${periodo.chave}` ? linha.tentativas_do_periodo : 0;
    let resultado: { enviado: boolean; falhas: string[] };
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
