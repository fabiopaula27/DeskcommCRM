/**
 * Dois tenants no mesmo WAHA: cada sessão entrega no token DELA, e evento de
 * outra sessão nunca é gravado na organização dona do token da URL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { WahaClient } from "./client";
import { eventoDeOutraSessao, montarUrlDoWebhookDaSessao } from "./webhook-por-sessao";

const base = "http://waha.test";
const urlA = "https://crm.test/api/v1/webhooks/waha/tokenA";
const urlB = "https://crm.test/api/v1/webhooks/waha/tokenB";

function wahaCom(config: Record<string, unknown>) {
  const puts: Array<{ name: string; config: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify({ name: "s1", status: "WORKING", config }), { status: 200 });
  }));
  return puts;
}

afterEach(() => vi.unstubAllGlobals());

describe("trava da rota por token", () => {
  it("recusa evento de outra sessão", () => {
    expect(eventoDeOutraSessao({ session: "tenant_b" }, "tenant_a")).toBe(true);
  });
  it("aceita a própria sessão, e corpo sem sessão segue como antes", () => {
    expect(eventoDeOutraSessao({ session: "tenant_a" }, "tenant_a")).toBe(false);
    expect(eventoDeOutraSessao({}, "tenant_a")).toBe(false);
  });
});

describe("montarUrlDoWebhookDaSessao", () => {
  it("compõe a rota por token sem barra dobrada", () => {
    expect(montarUrlDoWebhookDaSessao("https://crm.test/", "tokenA")).toBe(urlA);
  });
});

describe("garantirWebhookDaSessao", () => {
  it("grava a URL preservando o resto da config e webhook alheio", async () => {
    const alheio = { url: "https://outro.test/hook" };
    const puts = wahaCom({ ignore: { status: true }, webhooks: [alheio] });
    await expect(new WahaClient(base, "k").garantirWebhookDaSessao("s1", urlA, "segredo")).resolves.toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.config.ignore).toEqual({ status: true });
    expect(puts[0]?.config.webhooks).toEqual([
      alheio,
      expect.objectContaining({ url: urlA, hmac: { key: "segredo" }, events: expect.arrayContaining(["message.any"]) }),
    ]);
  });

  it("troca o webhook nosso antigo em vez de somar um segundo", async () => {
    const puts = wahaCom({ webhooks: [{ url: urlB }] });
    await new WahaClient(base, "k").garantirWebhookDaSessao("s1", urlA, null);
    const hooks = puts[0]?.config.webhooks as Array<{ url: string; hmac?: unknown }>;
    expect(hooks.map((w) => w.url)).toEqual([urlA]);
    expect(hooks[0]?.hmac).toBeUndefined();
  });

  it("já convergida: não faz PUT, porque o PUT reinicia a sessão", async () => {
    const puts = wahaCom({ webhooks: [{ url: urlA }] });
    await expect(new WahaClient(base, "k").garantirWebhookDaSessao("s1", urlA, null)).resolves.toBe(true);
    expect(puts).toHaveLength(0);
  });

  it("não lança quando o WAHA está fora", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("rede"); }));
    await expect(new WahaClient(base, "k").garantirWebhookDaSessao("s1", urlA, null)).resolves.toBe(false);
  });
});
