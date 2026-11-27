import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processar = vi.fn(async () => ({ recebidos: 1, gravados: 1, ignorados: 0, falhas: 0 }));
vi.mock("@/lib/channels/meta/app", () => ({ appDaMeta: async () => ({ appSecret: "seg", verifyToken: "vt" }) }));
vi.mock("@/lib/channels/meta-social/entrega", () => ({ processarEntrega: (...a: unknown[]) => processar(...(a as [])) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { GET, POST } from "./route";

const URL_BASE = "https://crm.test/api/v1/webhooks/meta-social";

beforeEach(() => processar.mockClear());

describe("webhook meta-social", () => {
  it("handshake com o verify token certo devolve o challenge; errado é 403", async () => {
    const ok = await GET(new NextRequest(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    const nao = await GET(new NextRequest(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123`));
    expect(nao.status).toBe(403);
  });

  it("assinatura inválida é 401 e nada é processado", async () => {
    const r = await POST(new NextRequest(URL_BASE, { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=00" } }));
    expect(r.status).toBe(401);
    expect(processar).not.toHaveBeenCalled();
  });

  it("assinatura válida processa e responde 200", async () => {
    const corpo = JSON.stringify({ object: "page", entry: [] });
    const sig = "sha256=" + createHmac("sha256", "seg").update(corpo).digest("hex");
    const r = await POST(new NextRequest(URL_BASE, { method: "POST", body: corpo, headers: { "x-hub-signature-256": sig } }));
    expect(r.status).toBe(200);
    expect(processar).toHaveBeenCalledOnce();
  });
});
