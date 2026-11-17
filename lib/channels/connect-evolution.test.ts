import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/secrets", () => ({
  encryptWebhookSecret: vi.fn(async (_db: unknown, p: string) => `enc:${p}`),
  decryptWebhookSecret: vi.fn(async (_db: unknown, c: string) => c.replace(/^enc:/, "")),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/env", () => ({
  env: { EVOLUTION_WEBHOOK_BASE_URL: "https://crm.exemplo.com/" },
}));

import { criarFakeDb, type FakeDb } from "./evolution/__fixtures__/fake-admin";
import { EvolutionError, type EvolutionClient } from "./evolution/client";
import {
  EvolutionConnectionError,
  atualizarConexaoEvolution,
  canalEvolution,
  conectarEvolution,
  desconectarEvolution,
  qrDaEvolution,
  reconectarEvolution,
} from "./connect-evolution";

const ORG = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

function fakeClient(over: Partial<EvolutionClient> = {}): EvolutionClient {
  return {
    criarInstancia: vi.fn(async () => ({ qrBase64: "data:image/png;base64,QR" })),
    conectar: vi.fn(async () => ({ qrBase64: "data:image/png;base64,QR2", pairingCode: null })),
    estado: vi.fn(async () => "connecting" as const),
    encerrar: vi.fn(async () => undefined),
    enviarTexto: vi.fn(),
    enviarMidia: vi.fn(),
    ...over,
  } as EvolutionClient;
}

let db: FakeDb;
beforeEach(() => {
  db = criarFakeDb({ channel_sessions: [] });
  vi.clearAllMocks();
});

const conectar = (client: EvolutionClient | null, d = db) =>
  conectarEvolution(d.admin, d.admin, client, { organizationId: ORG, userId: "u1", idempotencyKey: KEY });

describe("conectarEvolution", () => {
  it("cria a linha evolution com token e segredo novos e a instância com o webhook da sessão", async () => {
    const client = fakeClient();
    const r = await conectar(client);
    const linha = db.tables.channel_sessions![0]!;
    expect(linha.provider).toBe("evolution");
    expect(linha.id).toBe(r.channelSessionId);
    expect(linha.evolution_instance_name).toBe(`dc-${r.channelSessionId.replace(/-/g, "")}`);
    expect(linha.webhook_path_token).toMatch(/^[0-9a-f]{32}$/);
    expect(linha.status).toBe("SCAN_QR_CODE");
    const segredo = String(linha.webhook_secret_encrypted).replace(/^enc:/, "");
    expect(segredo.length).toBeGreaterThanOrEqual(16);
    expect(client.criarInstancia).toHaveBeenCalledWith({
      nome: linha.evolution_instance_name,
      webhookUrl: `https://crm.exemplo.com/api/v1/webhooks/channel/${linha.webhook_path_token}`,
      webhookSecret: segredo,
    });
    expect(r.qrBase64).toBe("data:image/png;base64,QR");
  });

  it("mesma idempotencyKey duas vezes = uma instância", async () => {
    const client = fakeClient();
    const a = await conectar(client);
    const b = await conectar(client);
    expect(b.channelSessionId).toBe(a.channelSessionId);
    expect(client.criarInstancia).toHaveBeenCalledTimes(1);
    expect(db.tables.channel_sessions).toHaveLength(1);
  });

  it("limite do plano estourado sobe cru (a rota dá 409) sem chamar a Evolution", async () => {
    const d = criarFakeDb({ channel_sessions: [] }, {
      channel_sessions: { code: "PT402", message: "limite_do_plano:canais:1" },
    });
    const client = fakeClient();
    await expect(conectar(client, d)).rejects.toMatchObject({ message: "limite_do_plano:canais:1" });
    expect(client.criarInstancia).not.toHaveBeenCalled();
  });

  it("23505 do índice de idempotência (corrida): replay da linha vencedora", async () => {
    const d = criarFakeDb({ channel_sessions: [] }, {
      channel_sessions: (linhas) => {
        // A requisição concorrente gravou entre o lookup e o insert.
        linhas.push({ id: "vencedora", organization_id: ORG, provider: "evolution", metadata: { evolution_idempotency_key: KEY } });
        return { code: "23505", message: "duplicate key channel_sessions_evolution_idempotency_unique" };
      },
    });
    const client = fakeClient();
    const r = await conectar(client, d);
    expect(r).toEqual({ channelSessionId: "vencedora", qrBase64: null });
    expect(client.criarInstancia).not.toHaveBeenCalled();
  });

  it("sem cliente (env ausente) = 503 evolution_nao_configurado", async () => {
    await expect(conectar(null)).rejects.toMatchObject({ code: "evolution_nao_configurado", status: 503 });
    expect(db.tables.channel_sessions).toHaveLength(0);
  });

  it("Evolution fora do ar: linha fica FAILED e o erro é 502", async () => {
    const client = fakeClient({
      criarInstancia: vi.fn(async () => {
        throw new EvolutionError("indisponivel", "x");
      }),
    });
    await expect(conectar(client)).rejects.toMatchObject({ status: 502 });
    expect(db.tables.channel_sessions![0]!.status).toBe("FAILED");
  });

  it("idempotencyKey inválida = 422", async () => {
    await expect(
      conectarEvolution(db.admin, db.admin, fakeClient(), { organizationId: ORG, userId: "u", idempotencyKey: "x" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

function sessao(p: Record<string, unknown> = {}) {
  return {
    id: "sess-a",
    organization_id: ORG,
    provider: "evolution",
    evolution_instance_name: "dc-sessa",
    webhook_path_token: "tok123",
    webhook_secret_encrypted: "enc:segredo-com-mais-de-16",
    status: "SCAN_QR_CODE",
    phone_number: null,
    archived_at: null,
    last_status_change_at: "2026-11-17T09:00:00.000Z",
    ...p,
  };
}

describe("qrDaEvolution", () => {
  it("canal arquivado: QR recusado sem falar com a Evolution", async () => {
    db.tables.channel_sessions!.push(sessao({ archived_at: "2026-11-17T00:00:00Z" }));
    const client = fakeClient();
    await expect(qrDaEvolution(db.admin, ORG, "sess-a", client)).rejects.toMatchObject({
      code: "channel_archived",
      status: 409,
    });
    expect(client.conectar).not.toHaveBeenCalled();
  });

  it("canal ativo devolve o QR da instância", async () => {
    db.tables.channel_sessions!.push(sessao());
    const client = fakeClient();
    const r = await qrDaEvolution(db.admin, ORG, "sess-a", client);
    expect(client.conectar).toHaveBeenCalledWith("dc-sessa");
    expect(r.qrBase64).toBe("data:image/png;base64,QR2");
  });

  it("outra organização = 404", async () => {
    db.tables.channel_sessions!.push(sessao({ organization_id: "outra" }));
    await expect(qrDaEvolution(db.admin, ORG, "sess-a", fakeClient())).rejects.toMatchObject({ status: 404 });
  });
});

describe("atualizarConexaoEvolution", () => {
  const open = (telefone: string | null) =>
    ({ tipo: "conexao", instancia: "dc-sessa", estado: "open", telefone }) as const;

  it("open com telefone novo = WORKING, telefone e carimbo de conexão", async () => {
    db.tables.channel_sessions!.push(sessao());
    const antes = Date.now();
    await atualizarConexaoEvolution(db.admin, {
      organizationId: ORG,
      channelSessionId: "sess-a",
      evento: open("5511999990000"),
      client: fakeClient(),
    });
    const l = db.tables.channel_sessions![0]!;
    expect(l.status).toBe("WORKING");
    expect(l.phone_number).toBe("5511999990000");
    expect(new Date(String(l.last_status_change_at)).getTime()).toBeGreaterThanOrEqual(antes);
  });

  it("dois open seguidos: o segundo não move last_status_change_at", async () => {
    db.tables.channel_sessions!.push(sessao());
    const input = { organizationId: ORG, channelSessionId: "sess-a", evento: open("5511999990000"), client: fakeClient() };
    await atualizarConexaoEvolution(db.admin, input);
    const primeiro = db.tables.channel_sessions![0]!.last_status_change_at;
    await new Promise((r) => setTimeout(r, 5));
    await atualizarConexaoEvolution(db.admin, input);
    expect(db.tables.channel_sessions![0]!.last_status_change_at).toBe(primeiro);
  });

  it.each([
    ["outra organização", { organization_id: "org-b", provider: "evolution", phone_number: "+5511999990000" }],
    ["um canal WAHA (sem +)", { organization_id: ORG, provider: "waha", phone_number: "5511999990000" }],
  ])("telefone já ativo em %s: encerra a instância e marca FAILED numero_em_uso", async (_n, outra) => {
    db.tables.channel_sessions!.push(sessao(), { id: "sess-x", archived_at: null, status: "WORKING", ...outra });
    const client = fakeClient();
    const r = await atualizarConexaoEvolution(db.admin, {
      organizationId: ORG,
      channelSessionId: "sess-a",
      evento: open("5511999990000"),
      client,
    });
    expect(client.encerrar).toHaveBeenCalledWith("dc-sessa");
    const l = db.tables.channel_sessions![0]!;
    expect(l.status).toBe("FAILED");
    expect(l.status_reason).toBe("numero_em_uso");
    expect(l.phone_number).toBeNull();
    expect(r.status).toBe("FAILED");
  });

  it("corrida: duas orgs dão open no mesmo número; a que conectou depois cai", async () => {
    db.tables.channel_sessions!.push(
      sessao({ id: "sess-a", organization_id: ORG, evolution_instance_name: "dc-a" }),
      sessao({ id: "sess-b", organization_id: "org-b", evolution_instance_name: "dc-b" }),
    );
    const client = fakeClient();
    // Ambos passam pela checagem prévia: simula gravando os dois como WORKING
    // antes da reconferência — a primeira já está gravada com hora anterior.
    db.tables.channel_sessions![0]!.status = "WORKING";
    db.tables.channel_sessions![0]!.phone_number = "5511999990000";
    db.tables.channel_sessions![0]!.last_status_change_at = "2026-11-17T09:00:00.000Z";
    const original = db.admin.from.bind(db.admin);
    let primeiraBusca = true;
    (db.admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as { select: (c?: string) => unknown };
      const sel = q.select.bind(q);
      return {
        ...q,
        select: (c?: string) => {
          // A checagem prévia de sess-b não vê sess-a (ela ainda não tinha gravado).
          if (c === "id" && primeiraBusca) {
            primeiraBusca = false;
            return { in: () => ({ is: () => ({ neq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
          }
          return sel(c);
        },
      };
    };
    const r = await atualizarConexaoEvolution(db.admin, {
      organizationId: "org-b", channelSessionId: "sess-b", evento: open("5511999990000"), client,
    });
    expect(r).toEqual({ status: "FAILED", motivo: "numero_em_uso" });
    expect(client.encerrar).toHaveBeenCalledWith("dc-b");
    expect(client.encerrar).not.toHaveBeenCalledWith("dc-a");
    expect(db.tables.channel_sessions![0]!.status).toBe("WORKING");
    expect(db.tables.channel_sessions![1]!.status).toBe("FAILED");
  });

  it.each(["FAILED", "STOPPED"])("canal antigo %s com o mesmo telefone não bloqueia um open novo", async (st) => {
    db.tables.channel_sessions!.push(sessao(), {
      id: "sess-velha", organization_id: ORG, provider: "evolution", phone_number: "5511999990000",
      archived_at: null, status: st,
    });
    const client = fakeClient();
    const r = await atualizarConexaoEvolution(db.admin, {
      organizationId: ORG, channelSessionId: "sess-a", evento: open("5511999990000"), client,
    });
    expect(r.status).toBe("WORKING");
    expect(client.encerrar).not.toHaveBeenCalled();
  });

  it("telefone de canal ARQUIVADO em outra org não bloqueia", async () => {
    db.tables.channel_sessions!.push(sessao(), {
      id: "sess-x", organization_id: "org-b", provider: "evolution", phone_number: "+5511999990000",
      archived_at: "2026-01-01T00:00:00Z", status: "STOPPED",
    });
    await atualizarConexaoEvolution(db.admin, {
      organizationId: ORG, channelSessionId: "sess-a", evento: open("5511999990000"), client: fakeClient(),
    });
    expect(db.tables.channel_sessions![0]!.status).toBe("WORKING");
  });

  it("qr = SCAN_QR_CODE; close = STOPPED, mas não apaga um FAILED", async () => {
    db.tables.channel_sessions!.push(sessao({ status: "STARTING" }));
    const base = { organizationId: ORG, channelSessionId: "sess-a", client: fakeClient() };
    await atualizarConexaoEvolution(db.admin, { ...base, evento: { tipo: "qr", instancia: "dc-sessa", qrBase64: "Q" } });
    expect(db.tables.channel_sessions![0]!.status).toBe("SCAN_QR_CODE");
    await atualizarConexaoEvolution(db.admin, { ...base, evento: { tipo: "conexao", instancia: "dc-sessa", estado: "close", telefone: null } });
    expect(db.tables.channel_sessions![0]!.status).toBe("STOPPED");
    db.tables.channel_sessions![0]!.status = "FAILED";
    await atualizarConexaoEvolution(db.admin, { ...base, evento: { tipo: "conexao", instancia: "dc-sessa", estado: "close", telefone: null } });
    expect(db.tables.channel_sessions![0]!.status).toBe("FAILED");
  });
});

describe("reconectarEvolution", () => {
  it("instância viva: reusa o nome e pede QR novo", async () => {
    db.tables.channel_sessions!.push(sessao({ status: "STOPPED" }));
    const client = fakeClient();
    await reconectarEvolution(db.admin, ORG, "sess-a", client);
    expect(client.conectar).toHaveBeenCalledWith("dc-sessa");
    expect(client.criarInstancia).not.toHaveBeenCalled();
    expect(db.tables.channel_sessions![0]!.webhook_path_token).toBe("tok123");
  });

  it("instância sumiu: recria com o MESMO nome, token e segredo", async () => {
    db.tables.channel_sessions!.push(sessao({ status: "FAILED" }));
    const client = fakeClient({ estado: vi.fn(async () => "inexistente" as const) });
    await reconectarEvolution(db.admin, ORG, "sess-a", client);
    expect(client.criarInstancia).toHaveBeenCalledWith({
      nome: "dc-sessa",
      webhookUrl: "https://crm.exemplo.com/api/v1/webhooks/channel/tok123",
      webhookSecret: "segredo-com-mais-de-16",
    });
    expect(db.tables.channel_sessions![0]!.status).toBe("SCAN_QR_CODE");
  });

  it("canal arquivado é recusado", async () => {
    db.tables.channel_sessions!.push(sessao({ archived_at: "2026-11-17T00:00:00Z" }));
    await expect(reconectarEvolution(db.admin, ORG, "sess-a", fakeClient())).rejects.toMatchObject({ status: 409 });
  });
});

describe("desconectarEvolution", () => {
  it("chama encerrar com o nome da instância", async () => {
    const client = fakeClient();
    await desconectarEvolution(client, { evolution_instance_name: "dc-sessa" });
    expect(client.encerrar).toHaveBeenCalledWith("dc-sessa");
  });

  it("Evolution falhou: rejeita (a rota não arquiva)", async () => {
    const client = fakeClient({
      encerrar: vi.fn(async () => {
        throw new EvolutionError("indisponivel", "x");
      }),
    });
    await expect(desconectarEvolution(client, { evolution_instance_name: "dc-sessa" })).rejects.toBeInstanceOf(
      EvolutionConnectionError,
    );
  });

  it("sem cliente = 503", async () => {
    await expect(desconectarEvolution(null, { evolution_instance_name: "dc-sessa" })).rejects.toMatchObject({ status: 503 });
  });
});

describe("canalEvolution", () => {
  it("responde pelo provider", () => {
    expect(canalEvolution({ provider: "evolution" })).toBe(true);
    expect(canalEvolution({ provider: "waha" })).toBe(false);
  });
});

describe("rotas", () => {
  const ler = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it.each([
    "app/api/v1/channels/evolution/route.ts",
    "app/api/v1/channels/evolution/[id]/reconnect/route.ts",
  ])("%s exige os mesmos papéis de POST /api/v1/channel-sessions", (f) => {
    const src = ler(f);
    expect(src).toMatch(/requireSupportWrite\(\)/);
    expect(src).toMatch(/requireRole\("admin", \{[^}]*allowPlatformAdmin: true/);
    expect(src).toMatch(/mfaEmDivida\(\)/);
  });
  it("a rota do QR devolve mensagem traduzida, não o código cru", () => {
    expect(ler("app/api/v1/channels/evolution/[id]/qr/route.ts")).not.toMatch(/fail\(error\.code, error\.code/);
  });
  it("migration e baseline têm o índice de idempotência", () => {
    for (const f of ["supabase/migrations/20261117120000_9108_canal_evolution.sql", "supabase/baseline.sql"]) {
      expect(ler(f)).toMatch(/channel_sessions_evolution_idempotency_unique[\s\S]*metadata->>'evolution_idempotency_key'/);
    }
  });
  it("a rota de exclusão não nomeia o provider: pergunta a canalEvolution", () => {
    const src = ler("app/api/v1/channel-sessions/[id]/route.ts");
    expect(src).toMatch(/canalEvolution\(session\)/);
    expect(src).not.toMatch(/["']evolution["']/);
  });
});
