/**
 * As contas de anúncio que a organização LIBEROU para a tela de Meta Ads.
 *
 * Guardadas na coluna `ad_insights_connections.default_account_id` (texto livre,
 * sem constraint) como lista separada por vírgula: a PRIMEIRA é a conta padrão,
 * as demais são as adicionais. Assim não precisa de migration, e a linha antiga
 * (uma conta só) continua sendo lida igual.
 *
 * O token de um gestor de tráfego alcança contas de vários clientes; só as
 * contas listadas aqui aparecem na tela e podem ser consultadas pela API.
 */
const FORMATO = /^act_\d+$/;

export function lerContasPermitidas(valor: string | null | undefined): string[] {
  const vistas = new Set<string>();
  for (const parte of (valor ?? "").split(",")) {
    const conta = parte.trim();
    if (FORMATO.test(conta)) vistas.add(conta);
  }
  return [...vistas];
}

export function gravarContasPermitidas(contas: readonly string[]): string | null {
  const limpas = lerContasPermitidas(contas.join(","));
  return limpas.length > 0 ? limpas.join(",") : null;
}
