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
