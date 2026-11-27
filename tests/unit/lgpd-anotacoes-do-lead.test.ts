import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anonimizar o contato leva os ÁUDIOS das anotações do lead (migration 9115).
 * As linhas saem pelo gatilho da 9115; o arquivo no bucket `contact-notes` só
 * sai se o caminho for enfileirado ANTES da RPC — depois dela as linhas já
 * foram apagadas e ninguém mais acha o arquivo.
 */
const ops: string[] = [];
const fila: Record<string, unknown>[] = [];
let notas: { audio_path: string | null }[] | null = [];
let erroDasNotas: { code?: string; message: string } | null = null;

function chain(resolver: () => Promise<unknown>): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: unknown) => unknown, f: (e: unknown) => unknown) => resolver().then(ok, f);
        if (prop === "maybeSingle" || prop === "single") return () => resolver();
        return () => proxy;
      },
    },
  ) as Record<string, unknown>;
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => ({
      select: () =>
        chain(async () => {
          ops.push(`select:${tabela}`);
          if (tabela === "contact_notes") return { data: notas, error: erroDasNotas };
          if (tabela === "contacts") return { data: { avatar_storage_path: null }, error: null };
          return { data: [], error: null };
        }),
      upsert: (payload: Record<string, unknown>) =>
        chain(async () => {
          ops.push(`fila:${String(payload.bucket)}`);
          fila.push(payload);
          return { error: null };
        }),
      update: () => chain(async () => ({ error: null })),
      delete: () => chain(async () => ({ error: null })),
    }),
    rpc: async () => {
      ops.push("rpc");
      return { data: { already_anonymized: false, counts: {}, media_paths: [] }, error: null };
    },
  }),
}));

import { cascadeRedactContact } from "@/lib/lgpd/redact-cascade";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const ARGS = { organizationId: ORG, contactId: CONTATO, requestId: "33333333-3333-4333-8333-333333333333" };

beforeEach(() => {
  ops.length = 0;
  fila.length = 0;
  notas = [];
  erroDasNotas = null;
});

describe("LGPD — áudios das anotações do lead", () => {
  it("enfileira cada áudio no bucket contact-notes, antes da RPC", async () => {
    notas = [{ audio_path: `${ORG}/${CONTATO}/a.webm` }, { audio_path: null }, { audio_path: `${ORG}/${CONTATO}/b.m4a` }];
    await cascadeRedactContact(ARGS);
    const dosAudios = fila.filter((f) => f.bucket === "contact-notes").map((f) => f.object_path);
    expect(dosAudios).toEqual([`${ORG}/${CONTATO}/a.webm`, `${ORG}/${CONTATO}/b.m4a`]);
    expect(ops.lastIndexOf("fila:contact-notes")).toBeLessThan(ops.indexOf("rpc"));
  });

  it("caminho fora da pasta do contato não é enfileirado (a fila remove com o admin)", async () => {
    notas = [{ audio_path: `outra-org/${CONTATO}/a.webm` }];
    await cascadeRedactContact(ARGS);
    expect(fila.filter((f) => f.bucket === "contact-notes")).toHaveLength(0);
  });

  it("instalação sem a migration 9115 segue anonimizando", async () => {
    notas = null;
    erroDasNotas = { code: "42P01", message: 'relation "contact_notes" does not exist' };
    await cascadeRedactContact(ARGS);
    expect(ops).toContain("rpc");
  });

  it("outro erro ao ler as anotações aborta antes da RPC (não anonimiza pela metade)", async () => {
    notas = null;
    erroDasNotas = { code: "57014", message: "timeout" };
    await expect(cascadeRedactContact(ARGS)).rejects.toThrow(/anotações/);
    expect(ops).not.toContain("rpc");
  });
});
