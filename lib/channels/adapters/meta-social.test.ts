import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let credencial: { token: string; paginaId: string; plataforma: "facebook" | "instagram" } | null = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("../meta-social/credenciais", () => ({ credencialDaConta: async () => credencial }));

import { corposDoEnvio, metaSocialAdapter } from "./meta-social";

const ENV = { organizationId: "org", sessionRef: "PAGE1", to: "provider-thread", providerConversationId: "LEAD" };
let respostas: { status: number; body: unknown }[] = [];
const chamadas: { url: string; body: unknown }[] = [];

beforeEach(() => {
  credencial = { token: "tok", paginaId: "PAGE1", plataforma: "facebook" };
  respostas = [];
  chamadas.length = 0;
  vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
    chamadas.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = respostas.shift() ?? { status: 200, body: { message_id: "mid.1" } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("metaSocialAdapter.send", () => {
  it("texto vai para /{página}/messages com o lead como destinatário e devolve o id no formato do eco", async () => {
    const r = await metaSocialAdapter.send({ ...ENV, kind: "text", body: "Olá!" } as never);
    expect(chamadas[0]?.url).toContain("/v21.0/PAGE1/messages");
    expect(chamadas[0]?.body).toEqual({ recipient: { id: "LEAD" }, messaging_type: "RESPONSE", message: { text: "Olá!" } });
    expect(r.externalId).toBe("social:PAGE1:mid.1");
  });

  it("imagem com legenda: anexo e depois o texto", async () => {
    await metaSocialAdapter.send({ ...ENV, kind: "image", media: { url: "https://s/x.jpg", mime: "image/jpeg", caption: "Segue" } } as never);
    expect(chamadas).toHaveLength(2);
    expect((chamadas[0]?.body as { message: { attachment: { type: string } } }).message.attachment.type).toBe("image");
    expect((chamadas[1]?.body as { message: { text: string } }).message.text).toBe("Segue");
  });

  it("fora da janela de 24h vira erro claro", async () => {
    respostas = [{ status: 400, body: { error: { code: 10, error_subcode: 2018278, message: "outside window" } } }];
    await expect(metaSocialAdapter.send({ ...ENV, kind: "text", body: "oi" } as never)).rejects.toThrow(/24h/);
  });

  it("token revogado (190) pede reconectar", async () => {
    respostas = [{ status: 401, body: { error: { code: 190, message: "expired" } } }];
    await expect(metaSocialAdapter.send({ ...ENV, kind: "text", body: "oi" } as never)).rejects.toThrow(/Reconecte/);
  });

  it("sem thread do lead não envia", async () => {
    await expect(metaSocialAdapter.send({ ...ENV, providerConversationId: null, kind: "text", body: "oi" } as never)).rejects.toThrow(/já escreveu/);
    expect(chamadas).toHaveLength(0);
  });
});

describe("metaSocialAdapter.checkHealth", () => {
  it("token bom → WORKING; 190 → FAILED reconectar; sem credencial → FAILED", async () => {
    expect((await metaSocialAdapter.checkHealth!({ organizationId: "org", sessionRef: "PAGE1" })).status).toBe("WORKING");
    respostas = [{ status: 401, body: { error: { code: 190, message: "x" } } }];
    expect(await metaSocialAdapter.checkHealth!({ organizationId: "org", sessionRef: "PAGE1" })).toMatchObject({ status: "FAILED", detail: "reconectar" });
    credencial = null;
    expect((await metaSocialAdapter.checkHealth!({ organizationId: "org", sessionRef: "PAGE1" })).status).toBe("FAILED");
  });
});

describe("corposDoEnvio", () => {
  it("áudio vira anexo de áudio; documento vira file", () => {
    const audio = corposDoEnvio({ kind: "audio", media: { url: "u", mime: "audio/ogg" } } as never, "L")[0] as { message: { attachment: { type: string } } };
    expect(audio.message.attachment.type).toBe("audio");
    const doc = corposDoEnvio({ kind: "document", media: { url: "u", mime: "application/pdf" } } as never, "L")[0] as { message: { attachment: { type: string } } };
    expect(doc.message.attachment.type).toBe("file");
  });
});

describe("revisão: saúde e erros", () => {
  it("limite de uso (código 4, HTTP 400) não marca o canal como caído", async () => {
    respostas = [{ status: 400, body: { error: { code: 4, message: "rate limit" } } }];
    expect(await metaSocialAdapter.checkHealth!({ organizationId: "org", sessionRef: "PAGE1" })).toMatchObject({ reachable: false, status: null });
  });
  it("551 diz que a pessoa está indisponível, não que passou das 24h", async () => {
    respostas = [{ status: 400, body: { error: { code: 551, message: "user unavailable" } } }];
    await expect(metaSocialAdapter.send({ ...ENV, kind: "text", body: "oi" } as never)).rejects.toThrow(/não está disponível/);
  });
});
