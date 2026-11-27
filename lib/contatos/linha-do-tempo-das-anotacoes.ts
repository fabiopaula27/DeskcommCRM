/**
 * Linha do tempo da aba "Anotações": anotações e tarefas do contato juntas,
 * mais recentes primeiro (cada item pela hora em que foi REGISTRADO).
 */
import type { Anotacao } from "@/lib/contatos/anotacoes";
import type { Tarefa } from "@/lib/tarefas/tipos";

export type ItemDaLinhaDoTempo =
  | { tipo: "anotacao"; em: string; anotacao: Anotacao }
  | { tipo: "tarefa"; em: string; tarefa: Tarefa };

export function linhaDoTempo(anotacoes: Anotacao[], tarefas: Tarefa[]): ItemDaLinhaDoTempo[] {
  const itens: ItemDaLinhaDoTempo[] = [
    ...anotacoes.map((a) => ({ tipo: "anotacao" as const, em: a.criadaEm, anotacao: a })),
    ...tarefas.map((t) => ({ tipo: "tarefa" as const, em: t.created_at, tarefa: t })),
  ];
  return itens.sort((x, y) => Date.parse(y.em) - Date.parse(x.em));
}

/** O tipo de gravação que este navegador sabe fazer (Safari/iPhone grava mp4). */
export function mimeDeGravacao(suporta: (mime: string) => boolean): string | null {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (suporta(m)) return m;
  }
  return null;
}

/** Campo personalizado onde "Salvar no campo Resumo" grava: o rotulado "Resumo". */
export function campoDoResumo(campos: { key: string; label: string }[]): string | null {
  const achado = campos.find((c) => c.label.trim().toLocaleLowerCase("pt-BR") === "resumo");
  return achado ? achado.key : null;
}
