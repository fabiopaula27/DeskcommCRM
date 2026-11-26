/**
 * Tarifa por mensagem de template da Meta para destinatários do Brasil, em US$.
 * ESTIMATIVA: a Meta cobra por mensagem entregue e muda a tabela de tempos em
 * tempos; a tela diz isso ao lado do número. Fonte: tabela de preços da
 * WhatsApp Business Platform (Brasil), 2025.
 */
export const TARIFA_BR_USD: Record<"MARKETING" | "UTILITY" | "AUTHENTICATION", number> = {
  MARKETING: 0.0625,
  UTILITY: 0.008,
  AUTHENTICATION: 0.0315,
};

export function tarifaDaCategoria(categoria: string | null | undefined): number {
  const c = (categoria ?? "").toUpperCase();
  return c in TARIFA_BR_USD ? TARIFA_BR_USD[c as keyof typeof TARIFA_BR_USD] : 0;
}

export function gastoEstimadoUsd(
  porTemplate: readonly { categoria: string | null; enviados: number }[],
): number {
  return porTemplate.reduce((s, t) => s + t.enviados * tarifaDaCategoria(t.categoria), 0);
}
