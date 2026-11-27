import { describe, expect, it, vi } from "vitest";

import { processarEntrega } from "./entrega";

const payload = (contaId: string) => ({
  object: "page",
  entry: [{ id: contaId, messaging: [{ sender: { id: "LEAD" }, recipient: { id: contaId }, timestamp: 1, message: { mid: "m1", text: "oi" } }] }],
});

describe("processarEntrega", () => {
  it("evento de conta conectada vai ao ingest com a organização DO CANAL", async () => {
    const ingerir = vi.fn(async () => ({}) as never);
    const sessao = vi.fn(async () => ({ id: "s1", organization_id: "orgA" }));
    const perfil = vi.fn(async () => ({ nome: "Sérgio Cruz", usuario: null }));
    const r = await processarEntrega({} as never, payload("P1"), { ingerir, sessao, perfil });
    expect(r).toEqual({ recebidos: 1, gravados: 1, ignorados: 0, falhas: 0 });
    expect(ingerir).toHaveBeenCalledWith({}, expect.objectContaining({ organizationId: "orgA", channelSessionId: "s1" }));
    expect(sessao).toHaveBeenCalledWith({}, "P1", "facebook");
    const enviado = (ingerir.mock.calls[0] as unknown as [unknown, { socialMessage: { identity: { displayName: string } } }])[1];
    expect(enviado.socialMessage.identity.displayName).toBe("Sérgio Cruz");
  });

  it("conta sem canal é ignorada, sem ingest", async () => {
    const ingerir = vi.fn();
    const r = await processarEntrega({} as never, payload("P9"), { ingerir, sessao: vi.fn(async () => null) });
    expect(r.ignorados).toBe(1);
    expect(ingerir).not.toHaveBeenCalled();
  });

  it("falha num evento é contada e não lança", async () => {
    const r = await processarEntrega({} as never, payload("P1"), {
      ingerir: vi.fn(async () => {
        throw new Error("boom");
      }),
      sessao: vi.fn(async () => ({ id: "s1", organization_id: "orgA" })),
      perfil: vi.fn(async () => ({ nome: null, usuario: null })),
    });
    expect(r.falhas).toBe(1);
  });
});

import { ehEcoDoCrm } from "./entrega";
import { parsearEventos } from "./parser";

const eco = (appId?: number) =>
  parsearEventos({
    object: "page",
    entry: [{ id: "P1", messaging: [{ sender: { id: "P1" }, recipient: { id: "LEAD" }, timestamp: 1, message: { mid: "m9", text: "Olá!", is_echo: true, ...(appId ? { app_id: appId } : {}) } }] }],
  })[0]!;

describe("eco do próprio CRM", () => {
  const sessao = { id: "s1", organization_id: "orgA" };

  it("Messenger: eco com o app_id do CRM é nosso; de outro app (Business Suite, celular) não é", async () => {
    expect(await ehEcoDoCrm({} as never, eco(123), sessao, "123")).toBe(true);
    expect(await ehEcoDoCrm({} as never, eco(999), sessao, "123")).toBe(false);
  });

  it("mensagem do lead nunca é eco", async () => {
    const doLead = parsearEventos(payload("P1"))[0]!;
    expect(await ehEcoDoCrm({} as never, doLead, sessao, "123")).toBe(false);
  });

  it("Instagram sem app_id: legenda de mídia que o CRM acabou de mandar é eco", async () => {
    const tabelas: string[] = [];
    const db = {
      from: (t: string) => {
        tabelas.push(t);
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in", "neq", "is", "gte"]) q[m] = () => q;
        q.maybeSingle = async () => ({ data: { id: "c1" }, error: null });
        q.limit = async () => ({ data: t === "messages" && tabelas.filter((x) => x === "messages").length === 2 ? [{ id: "m" }] : [], error: null });
        return q;
      },
    };
    expect(await ehEcoDoCrm(db as never, eco(), sessao, "123")).toBe(true);
  });

  it("eco do CRM não vai ao ingest (nem duplica, nem pausa a IA)", async () => {
    const ingerir = vi.fn();
    const r = await processarEntrega({} as never, { object: "page", entry: [{ id: "P1", messaging: [{ sender: { id: "P1" }, recipient: { id: "LEAD" }, timestamp: 1, message: { mid: "m9", text: "Olá!", is_echo: true, app_id: 123 } }] }] }, {
      ingerir,
      sessao: vi.fn(async () => sessao),
      perfil: vi.fn(async () => ({ nome: null, usuario: null })),
      ecoDoCrm: vi.fn(async () => true),
    });
    expect(ingerir).not.toHaveBeenCalled();
    expect(r.ignorados).toBe(1);
  });
});
