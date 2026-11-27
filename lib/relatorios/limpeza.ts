/**
 * Os PDFs do envio agendado (bucket `relatorios`, pasta por organização) só
 * precisam existir até o canal baixar — o link vale 1 hora. Guardar mais que
 * 7 dias seria acumular dado de gestor sem motivo. O cron do envio chama esta
 * limpeza a cada rodada; falha aqui nunca impede o envio.
 */
export const DIAS_DE_GUARDA = 7;

type Item = { name: string; id: string | null; created_at?: string | null };
type Bucket = {
  list: (pasta: string, opcoes?: { limit?: number }) => Promise<{ data: Item[] | null; error: unknown }>;
  remove: (caminhos: string[]) => Promise<{ error: unknown }>;
};

export async function limparPdfsAntigos(bucket: Bucket, agora: Date): Promise<number> {
  const limite = agora.getTime() - DIAS_DE_GUARDA * 24 * 60 * 60 * 1000;
  const { data: pastas } = await bucket.list("", { limit: 1000 });
  let apagados = 0;
  for (const pasta of pastas ?? []) {
    if (pasta.id !== null) continue; // arquivo solto na raiz: não é deste envio
    const { data: arquivos } = await bucket.list(pasta.name, { limit: 1000 });
    const velhos = (arquivos ?? [])
      .filter((a) => a.id !== null && a.created_at && new Date(a.created_at).getTime() < limite)
      .map((a) => `${pasta.name}/${a.name}`);
    if (velhos.length === 0) continue;
    const { error } = await bucket.remove(velhos);
    if (!error) apagados += velhos.length;
  }
  return apagados;
}
