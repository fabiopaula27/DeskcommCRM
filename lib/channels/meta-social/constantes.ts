/**
 * Folha sem dependências: o envio (adapter) e a conexão leem daqui, e não do
 * módulo de recebimento — que puxa o ingest inteiro e, importado pelo adapter,
 * fechava um ciclo que quebrava o carregamento do worker (TDZ no laço do
 * event_log).
 */
export const PROVIDER_META_SOCIAL = "meta_social";
