/**
 * Consumo de IA nos Relatórios: a soma vem de `fn_uso_de_ia` (a mesma da tela
 * Uso de IA); aqui só se nomeia o uso e se agrupa por mês.
 */
type Tokens = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export function tokensDe(t: Tokens): number {
  return (t.input_tokens ?? 0) + (t.output_tokens ?? 0) + (t.cache_read_tokens ?? 0) + (t.cache_write_tokens ?? 0);
}

export function somarPorMes(
  dias: readonly (Tokens & { dia: string; custo_cents: number; chamadas: number })[],
): { mes: string; tokens: number; custo_cents: number; chamadas: number }[] {
  const porMes = new Map<string, { mes: string; tokens: number; custo_cents: number; chamadas: number }>();
  for (const d of dias) {
    const mes = d.dia.slice(0, 7);
    const atual = porMes.get(mes) ?? { mes, tokens: 0, custo_cents: 0, chamadas: 0 };
    atual.tokens += tokensDe(d);
    atual.custo_cents += Number(d.custo_cents ?? 0);
    atual.chamadas += d.chamadas ?? 0;
    porMes.set(mes, atual);
  }
  return [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/** O nome que o dono da empresa entende para cada uso. Vocabulário aberto: o desconhecido aparece como veio. */
const ROTULOS: Record<string, string> = {
  agent_turn: "Atendimento da IA",
  followup_turn: "Follow-ups",
  bot_respond: "Respostas automáticas",
  send_message: "Envio de mensagens",
  classify: "Classificação de mensagens",
  sentiment_classify: "Análise de sentimento",
  jailbreak_detect: "Proteção contra abuso",
  visao_de_imagem: "Leitura de imagens",
  transcricao_de_audio: "Transcrição de áudio",
  sintese_de_voz: "Voz da IA",
  embedding_indexar: "Base de conhecimento",
  agent_preview: "Testes do agente",
  proposal_assistant: "Propostas",
  proposal_fill_from_conversation: "Propostas",
  proposal_template_import: "Propostas",
  promise_semantic: "Verificação de promessas",
  plan_timing: "Planejamento de horários",
  prospecting_agent_setup_chat: "Prospecção",
};

export function rotuloDoUso(purpose: string | null | undefined): string {
  if (!purpose) return "Outros";
  return ROTULOS[purpose] ?? purpose;
}
