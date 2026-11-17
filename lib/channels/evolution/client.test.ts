import { describe, expect, it, vi } from "vitest";

import { createEvolutionClient, EvolutionError, nomeDaInstancia } from "./client";

const KEY = "SEGREDO-APIKEY-123";
const resp = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  const client = createEvolutionClient({
    url: "http://evo.test/",
    apiKey: KEY,
    fetch: fetchMock as unknown as typeof fetch,
  })!;
  return { client, fetchMock };
}

describe("nomeDaInstancia", () => {
  it("dc- + uuid sem hifens", () => {
    expect(nomeDaInstancia("123e4567-e89b-12d3-a456-426614174000")).toBe(
      "dc-123e4567e89b12d3a456426614174000",
    );
  });
});

describe("createEvolutionClient", () => {
  it("null sem configuracao", () => {
    expect(createEvolutionClient({ url: "", apiKey: "" })).toBeNull();
  });

  it("criarInstancia", async () => {
    const { client, fetchMock } = setup(async () => resp(201, { qrcode: { base64: "QR" } }));
    const r = await client.criarInstancia({
      nome: "dc-x",
      webhookUrl: "https://c/w/tok",
      webhookSecret: "sec",
    });
    expect(r.qrBase64).toBe("QR");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo.test/instance/create");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).apikey).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      instanceName: "dc-x",
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: {
        url: "https://c/w/tok",
        base64: true,
        headers: { "x-webhook-secret": "sec" },
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
      },
    });
  });

  it("enviarTexto", async () => {
    const { client, fetchMock } = setup(async () => resp(201, { key: { id: "EXT1" } }));
    const r = await client.enviarTexto({ nome: "dc-x", numero: "5511999990001", texto: "oi" });
    expect(r.externalId).toBe("EXT1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://evo.test/message/sendText/dc-x");
    expect(JSON.parse(init.body as string)).toMatchObject({ number: "5511999990001", text: "oi" });
  });

  it("enviarMidia usa sendMedia e audio usa sendWhatsAppAudio", async () => {
    const { client, fetchMock } = setup(async () => resp(201, { key: { id: "E" } }));
    await client.enviarMidia({
      nome: "n",
      numero: "1",
      tipo: "image",
      base64OuUrl: "AAA",
      mimetype: "image/png",
      legenda: "l",
    });
    await client.enviarMidia({
      nome: "n",
      numero: "1",
      tipo: "audio",
      base64OuUrl: "AAA",
      mimetype: "audio/ogg",
    });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://evo.test/message/sendMedia/n");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      mediatype: "image",
      caption: "l",
      media: "AAA",
    });
    expect(fetchMock.mock.calls[1]![0]).toBe("http://evo.test/message/sendWhatsAppAudio/n");
  });

  it("estado", async () => {
    const a = setup(async () => resp(200, { instance: { instanceName: "n", state: "open" } }));
    expect(await a.client.estado("n")).toBe("open");
    const b = setup(async () => resp(404, { message: "nope" }));
    expect(await b.client.estado("n")).toBe("inexistente");
  });

  it("fetch rejeitando vira indisponivel sem vazar apikey", async () => {
    const { client } = setup(async () => {
      throw new Error(`falha de rede com ${KEY}`);
    });
    const err = await client.estado("n").catch((e) => e);
    expect(err).toBeInstanceOf(EvolutionError);
    expect(err.code).toBe("indisponivel");
    expect(String(err)).not.toContain(KEY);
    expect(err.message).not.toContain(KEY);
  });

  it("codigos de erro por status", async () => {
    const e401 = await setup(async () => resp(401)).client.conectar("n").catch((e) => e);
    expect(e401.code).toBe("recusado");
    const e404 = await setup(async () => resp(404)).client.conectar("n").catch((e) => e);
    expect(e404.code).toBe("nao_encontrado");
    const e500 = await setup(async () => resp(502)).client.conectar("n").catch((e) => e);
    expect(e500.code).toBe("indisponivel");
  });

  it("encerrar tolera 404", async () => {
    const { client, fetchMock } = setup(async () => resp(404));
    await expect(client.encerrar("n")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "http://evo.test/instance/logout/n",
      "http://evo.test/instance/delete/n",
    ]);
  });

  it("encerrar chama delete mesmo se logout falhar (rede ou 5xx)", async () => {
    const a = setup(async (url) => {
      if (url.includes("/logout/")) throw new Error("rede");
      return resp(200);
    });
    await expect(a.client.encerrar("n")).resolves.toBeUndefined();
    expect(a.fetchMock.mock.calls.map((c) => c[0])).toContain("http://evo.test/instance/delete/n");
    const b = setup(async (url) => (url.includes("/logout/") ? resp(500) : resp(200)));
    await expect(b.client.encerrar("n")).resolves.toBeUndefined();
    expect(b.fetchMock.mock.calls).toHaveLength(2);
  });

  it("encerrar propaga falha do delete", async () => {
    const { client } = setup(async (url) => (url.includes("/delete/") ? resp(500) : resp(200)));
    const err = await client.encerrar("n").catch((e) => e);
    expect(err.code).toBe("indisponivel");
  });

  it("429 vira indisponivel", async () => {
    const err = await setup(async () => resp(429)).client.conectar("n").catch((e) => e);
    expect(err.code).toBe("indisponivel");
  });

  it("enviarMidia document leva fileName", async () => {
    const { client, fetchMock } = setup(async () => resp(201, { key: { id: "E" } }));
    await client.enviarMidia({
      nome: "n",
      numero: "1",
      tipo: "document",
      base64OuUrl: "AAA",
      mimetype: "application/pdf",
      nomeArquivo: "a.pdf",
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toMatchObject({
      mediatype: "document",
      fileName: "a.pdf",
    });
  });
});
