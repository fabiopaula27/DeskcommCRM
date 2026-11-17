/**
 * Dublê mínimo do cliente Supabase para os testes do canal Evolution.
 *
 * Os filtros MORDEM: `eq`/`not in`/`is null` são aplicados contra linhas em
 * memória, e o `unique (organization_id, external_id)` de `messages` devolve
 * 23505 como o banco. Um dublê que só registrasse a chamada provaria que o
 * update foi PEDIDO, não que alcançou a linha certa — e a linha certa, aqui, é
 * a da organização certa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  uploads: Array<{ bucket: string; path: string; bytes: number; contentType?: string }>;
  admin: SupabaseClient;
}

let seq = 0;

/** Lê `coluna` ou `coluna->>chave` (filtro em jsonb, como o PostgREST). */
function ler(r: Row, c: string): unknown {
  const [col, chave] = c.split("->>");
  const v = r[col!];
  if (chave === undefined) return v;
  return v && typeof v === "object" ? ((v as Row)[chave] ?? null) : null;
}

export function criarFakeDb(
  seed: Record<string, Row[]> = {},
  /** Erro devolvido no próximo INSERT da tabela (ex.: o PT402 do limite do plano). */
  falhaNoInsert: Record<
    string,
    { code?: string; message: string } | ((linhas: Row[]) => { code?: string; message: string } | null)
  > = {},
): FakeDb {
  const tables: Record<string, Row[]> = { messages: [], ...seed };
  const rpcs: FakeDb["rpcs"] = [];
  const uploads: FakeDb["uploads"] = [];

  function query(table: string, op: "select" | "insert" | "update", payload?: Row) {
    const filtros: Array<(r: Row) => boolean> = [];
    const rows = () => (tables[table] ??= []);
    const exec = (): { data: Row[] | null; error: { code?: string; message: string } | null } => {
      if (op === "insert") {
        const f = falhaNoInsert[table];
        const erro = typeof f === "function" ? f(rows()) : (f ?? null);
        if (erro) return { data: null, error: erro };
        const nova = { id: `${table}-${++seq}`, ...payload } as Row;
        if (
          table === "messages" &&
          rows().some(
            (r) => r.organization_id === nova.organization_id && r.external_id === nova.external_id,
          )
        ) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows().push(nova);
        return { data: [nova], error: null };
      }
      const alvo = rows().filter((r) => filtros.every((f) => f(r)));
      if (op === "update") for (const r of alvo) Object.assign(r, payload);
      return { data: alvo, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filtros.push((r) => ler(r, c) === v), b),
      neq: (c: string, v: unknown) => (filtros.push((r) => ler(r, c) !== v), b),
      in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(ler(r, c))), b),
      is: (c: string, v: unknown) => (filtros.push((r) => (ler(r, c) ?? null) === v), b),
      gte: (c: string, v: unknown) => (filtros.push((r) => String(ler(r, c) ?? "") >= String(v)), b),
      limit: () => b,
      not: (c: string, o: string, v: string) => {
        if (o === "in") {
          const lista = v.replace(/[()]/g, "").split(",");
          filtros.push((r) => !lista.includes(String(r[c])));
        }
        return b;
      },
      maybeSingle: async () => {
        const { data, error } = exec();
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = exec();
        return { data: data?.[0] ?? null, error: error ?? (data?.[0] ? null : { message: "0 rows" }) };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(ok, ko),
    };
    return b;
  }

  const admin = {
    from: (table: string) => ({
      select: () => query(table, "select"),
      insert: (p: Row) => query(table, "insert", p),
      update: (p: Row) => query(table, "update", p),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === "fn_upsert_wa_contact") return { data: "contact-1", error: null };
      if (name === "fn_upsert_wa_conversation") return { data: `conv-${args.p_org}`, error: null };
      return { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Buffer, o?: { contentType?: string }) => {
          uploads.push({ bucket, path, bytes: body.byteLength, contentType: o?.contentType });
          return { data: { path }, error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { tables, rpcs, uploads, admin };
}
