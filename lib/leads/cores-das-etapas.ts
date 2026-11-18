/**
 * As cores prontas de etapa do funil (`crm_stages.color`, formato `#rrggbb` do
 * CHECK `crm_stages_color_format`). Uma paleta fechada mantém o quadro legível:
 * cores médias, com contraste suficiente para o ponto e a faixa da coluna nos
 * dois temas.
 */
export const CORES_DAS_ETAPAS = [
  { cor: "#6366f1", nome: "Índigo" },
  { cor: "#3b82f6", nome: "Azul" },
  { cor: "#0ea5e9", nome: "Céu" },
  { cor: "#14b8a6", nome: "Verde-água" },
  { cor: "#22c55e", nome: "Verde" },
  { cor: "#84cc16", nome: "Lima" },
  { cor: "#eab308", nome: "Amarelo" },
  { cor: "#f97316", nome: "Laranja" },
  { cor: "#ef4444", nome: "Vermelho" },
  { cor: "#ec4899", nome: "Rosa" },
  { cor: "#a855f7", nome: "Roxo" },
  { cor: "#64748b", nome: "Cinza" },
] as const;

/** Cor sugerida para a etapa na posição `i` — cada uma diferente da vizinha. */
export function corSugerida(i: number): string {
  return CORES_DAS_ETAPAS[((i % CORES_DAS_ETAPAS.length) + CORES_DAS_ETAPAS.length) % CORES_DAS_ETAPAS.length]!.cor;
}

export function ehCorDeEtapa(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}
