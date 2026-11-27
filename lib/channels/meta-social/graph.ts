/**
 * Chamadas à Graph API da Meta para Messenger e Instagram (conexão direta).
 * Erro da Graph vira `ErroGraph` com código e subcódigo — é o que separa
 * "token caiu" (190) de "fora da janela de 24h" (10/2018278, 551, IG 2534022).
 */
export const GRAPH_SOCIAL = "https://graph.facebook.com/v21.0";

export class ErroGraph extends Error {
  constructor(
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    message: string,
  ) {
    super(message);
    this.name = "ErroGraph";
  }
}

export function tokenCaiu(e: unknown): boolean {
  return e instanceof ErroGraph && (e.code === 190 || e.code === 102 || (e.code === 200 && e.subcode === 1545041));
}

export function foraDaJanela(e: unknown): boolean {
  return (
    e instanceof ErroGraph &&
    (e.subcode === 2018278 || e.subcode === 2534022 || (e.code === 10 && e.subcode === 2018065))
  );
}

/** 551: a pessoa não está disponível (bloqueou a página ou a conta saiu do ar). */
export function pessoaIndisponivel(e: unknown): boolean {
  return e instanceof ErroGraph && e.code === 551;
}

export async function graphSocial<T = Record<string, unknown>>(
  token: string,
  caminho: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; params?: Record<string, string> } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const url = new URL(`${GRAPH_SOCIAL}/${caminho.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  const res = await fetcher(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: number; error_subcode?: number; message?: string } })
    | null;
  if (!res.ok || json?.error) {
    const e = json?.error;
    throw new ErroGraph(res.status, e?.code ?? null, e?.error_subcode ?? null, e?.message ?? res.statusText);
  }
  return json as T;
}
