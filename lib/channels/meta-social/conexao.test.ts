import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: async (_db: unknown, t: string) => `enc(${t})` }));
vi.mock("@/lib/ai/elegibilidade/pre-go-live", () => ({ metadataInicialDoCanal: () => ({}) }));

import { conectarContas, listarContas, urlDoLogin, type ContaAutorizada } from "./conexao";

function fetchFalso(respostas: Record<string, unknown>) {
  const chamadas: string[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = String(url);
    chamadas.push(`${init?.method ?? "GET"} ${u}`);
    const chave = Object.keys(respostas).find((k) => u.includes(k));
    return new Response(JSON.stringify(chave ? respostas[chave] : { success: true }), { status: 200 });
  }) as typeof fetch;
  return { f, chamadas };
}

/** Banco falso: canal ativo da MESMA empresa (ou nenhum) e o erro do insert. */
function bancoFalso(ativoDaEmpresa: { id: string } | null, erroDoInsert: { code: string; message: string } | null = null) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        maybeSingle: async () => ({ data: ativoDaEmpresa, error: null }),
        insert: async (row: Record<string, unknown>) => (inserts.push(row), { error: erroDoInsert }),
        update: (row: Record<string, unknown>) => (updates.push(row), { eq: () => ({ eq: async () => ({ error: null }) }) }),
      };
      return q;
    },
  };
  return { db: db as never, inserts, updates };
}

const PAGINA: ContaAutorizada = { plataforma: "facebook", contaId: "P1", paginaId: "P1", nome: "Gestor da Web", tokenDaPagina: "tokP1" };
const IG: ContaAutorizada = { plataforma: "instagram", contaId: "IG1", paginaId: "P1", nome: "@gestordaweb", tokenDaPagina: "tokP1" };

describe("urlDoLogin", () => {
  it("com ID de configuração usa config_id; sem ele pede as permissões", () => {
    const com = new URL(urlDoLogin({ appId: "A", configId: "C" }, "https://x/cb", "st"));
    expect(com.searchParams.get("config_id")).toBe("C");
    expect(com.searchParams.get("scope")).toBeNull();
    const sem = new URL(urlDoLogin({ appId: "A", configId: null }, "https://x/cb", "st"));
    expect(sem.searchParams.get("scope")).toContain("instagram_manage_messages");
    expect(sem.searchParams.get("state")).toBe("st");
  });
});

describe("listarContas", () => {
  it("cada página vira Messenger, e o Instagram ligado usa o token da página", async () => {
    const { f } = fetchFalso({
      "me/accounts": { data: [{ id: "P1", name: "Gestor", access_token: "tokP1", instagram_business_account: { id: "IG1", username: "gestordaweb" } }, { id: "P2", name: "Sem IG", access_token: "tokP2" }] },
    });
    const contas = await listarContas("user", f);
    expect(contas.map((c) => [c.plataforma, c.contaId, c.tokenDaPagina])).toEqual([
      ["facebook", "P1", "tokP1"],
      ["instagram", "IG1", "tokP1"],
      ["facebook", "P2", "tokP2"],
    ]);
    expect(contas[1]?.nome).toBe("@gestordaweb");
  });
});

describe("conectarContas", () => {
  it("cria os canais, cifra o token e inscreve a página UMA vez", async () => {
    const { db, inserts } = bancoFalso(null);
    const { f, chamadas } = fetchFalso({});
    const r = await conectarContas(db, "orgA", [PAGINA, IG], f);
    expect(r.conectadas).toEqual(["Gestor da Web", "@gestordaweb"]);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ organization_id: "orgA", meta_social_account_id: "P1", meta_social_token_encrypted: "enc(tokP1)", meta_social_platform: "facebook" });
    expect(chamadas.filter((c) => c.includes("subscribed_apps"))).toHaveLength(1);
  });

  it("conta ativa em OUTRA empresa: o índice único recusa e ela não é tomada", async () => {
    const { db } = bancoFalso(null, { code: "23505", message: "duplicate key" });
    const { f, chamadas } = fetchFalso({});
    const r = await conectarContas(db, "orgA", [PAGINA], f);
    expect(r.emOutraEmpresa).toEqual(["Gestor da Web"]);
    expect(r.conectadas).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });

  it("canal já ativo na mesma empresa é atualizado (token novo), não duplicado", async () => {
    const { db, inserts, updates } = bancoFalso({ id: "s1" });
    await conectarContas(db, "orgA", [PAGINA], fetchFalso({}).f);
    expect(inserts).toHaveLength(0);
    expect(updates[0]).toMatchObject({ meta_social_token_encrypted: "enc(tokP1)", status: "WORKING" });
  });
});
