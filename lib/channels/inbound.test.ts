import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/contato-por-telefone", () => ({
  encontrarContatoPorTelefone: vi.fn(async () => null),
}));
vi.mock("@/lib/channels/pos-entrada", () => ({
  aplicarEfeitosPosEntrada: vi.fn(async () => undefined),
}));
vi.mock("@/lib/escalacao/resposta-whatsapp-ao-caso", () => ({
  consumirRespostaDoSuporteNoWhatsApp: vi.fn(async () => false),
}));
vi.mock("@/lib/escalacao/atendimento-manual", () => ({
  pausarIaPorAtendimentoManual: vi.fn(async () => undefined),
}));

import { CHANNEL_PROVIDER_EVOLUTION } from "./capabilities";
import { criarFakeDb, type FakeDb } from "./evolution/__fixtures__/fake-admin";
import {
  acceptsInboundWebhook,
  handleInboundWebhook,
  inboundPayloadBelongsToSession,
  verifyInboundWebhookSignature,
} from "./inbound";

const SEGREDO_A = "a".repeat(32);
const SEGREDO_B = "b".repeat(32);

const sessaoA = { id: "sess-a", organization_id: "org-a", provider: CHANNEL_PROVIDER_EVOLUTION };
const sessaoB = { id: "sess-b", organization_id: "org-b", provider: CHANNEL_PROVIDER_EVOLUTION };

function corpo(instance: string, id = "WA1"): string {
  return JSON.stringify({
    event: "messages.upsert",
    instance,
    data: {
      key: { remoteJid: "5511999990000@s.whatsapp.net", fromMe: false, id },
      pushName: "Ana",
      message: { conversation: "oi" },
      messageTimestamp: Math.floor(Date.parse("2026-11-17T10:05:00Z") / 1000),
    },
  });
}
const headers = (s: string) => new Headers({ "x-deskcomm-webhook-secret": s });

let db: FakeDb;
beforeEach(() => {
  db = criarFakeDb({
    channel_sessions: [
      { id: "sess-a", organization_id: "org-a", provider: "evolution", evolution_instance_name: "inst-a", status: "WORKING", last_status_change_at: "2026-11-17T10:00:00Z" },
      { id: "sess-b", organization_id: "org-b", provider: "evolution", evolution_instance_name: "inst-b", status: "WORKING", last_status_change_at: "2026-11-17T10:00:00Z" },
    ],
  });
});

describe("evolution na entrada genérica", () => {
  it("aceita webhook", () => {
    expect(acceptsInboundWebhook(CHANNEL_PROVIDER_EVOLUTION)).toBe(true);
  });

  it("assinatura: header igual ao segredo", () => {
    expect(verifyInboundWebhookSignature(CHANNEL_PROVIDER_EVOLUTION, "{}", headers(SEGREDO_A), SEGREDO_A)).toBe(true);
    expect(verifyInboundWebhookSignature(CHANNEL_PROVIDER_EVOLUTION, "{}", new Headers(), SEGREDO_A)).toBe(false);
    expect(verifyInboundWebhookSignature(CHANNEL_PROVIDER_EVOLUTION, "{}", headers(SEGREDO_B), SEGREDO_A)).toBe(false);
    expect(verifyInboundWebhookSignature(CHANNEL_PROVIDER_EVOLUTION, "{}", headers("curto"), "curto")).toBe(false);
  });

  it("payload de outra instância não pertence à sessão", async () => {
    const base = { session: sessaoA, headers: headers(SEGREDO_A), secret: SEGREDO_A };
    expect(await inboundPayloadBelongsToSession(db.admin, { ...base, rawBody: corpo("inst-a") })).toBe(true);
    expect(await inboundPayloadBelongsToSession(db.admin, { ...base, rawBody: corpo("inst-b") })).toBe(false);
    expect(await inboundPayloadBelongsToSession(db.admin, { ...base, rawBody: "nao-json" })).toBe(false);
  });

  it("token da org A + instância de A grava na org A", async () => {
    const r = await handleInboundWebhook(db.admin, {
      session: sessaoA,
      rawBody: corpo("inst-a"),
      headers: headers(SEGREDO_A),
      secret: SEGREDO_A,
    });
    expect(r.ok).toBe(true);
    expect(db.tables.messages!).toHaveLength(1);
    expect(db.tables.messages![0]!).toMatchObject({ organization_id: "org-a", channel_session_id: "sess-a" });
  });

  it("token da org A + corpo com instância de B não insere nada", async () => {
    const r = await handleInboundWebhook(db.admin, {
      session: sessaoA,
      rawBody: corpo("inst-b"),
      headers: headers(SEGREDO_A),
      secret: SEGREDO_A,
    });
    expect(r).toMatchObject({ ok: true, body: { status: "ignored", reason: "outra_instancia" } });
    expect(db.tables.messages!).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
  });

  it("segredo de B no token de A é recusado", async () => {
    const r = await handleInboundWebhook(db.admin, {
      session: sessaoA,
      rawBody: corpo("inst-a"),
      headers: headers(SEGREDO_B),
      secret: SEGREDO_A,
    });
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    expect(db.tables.messages!).toHaveLength(0);
  });

  it("cada token grava na sua org, mesmo external_id", async () => {
    await handleInboundWebhook(db.admin, { session: sessaoA, rawBody: corpo("inst-a"), headers: headers(SEGREDO_A), secret: SEGREDO_A });
    await handleInboundWebhook(db.admin, { session: sessaoB, rawBody: corpo("inst-b"), headers: headers(SEGREDO_B), secret: SEGREDO_B });
    expect(db.tables.messages!.map((m) => m.organization_id).sort()).toEqual(["org-a", "org-b"]);
  });

  it("corpo fora do contrato devolve contrato_violado", async () => {
    const r = await handleInboundWebhook(db.admin, {
      session: sessaoA,
      rawBody: JSON.stringify({ event: 1 }),
      headers: headers(SEGREDO_A),
      secret: SEGREDO_A,
    });
    expect(r).toMatchObject({ ok: false, code: "contrato_violado" });
  });
});
