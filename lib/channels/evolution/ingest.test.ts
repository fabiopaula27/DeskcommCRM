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
vi.mock("@/lib/channels/health", () => ({
  sincronizarSaudeDaConexao: vi.fn(async () => "sem_mudanca"),
}));

import { aplicarEfeitosPosEntrada } from "@/lib/channels/pos-entrada";
import { consumirRespostaDoSuporteNoWhatsApp } from "@/lib/escalacao/resposta-whatsapp-ao-caso";
import { pausarIaPorAtendimentoManual } from "@/lib/escalacao/atendimento-manual";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { sincronizarSaudeDaConexao } from "@/lib/channels/health";

import { criarFakeDb, type FakeDb } from "./__fixtures__/fake-admin";
import { ingestEvolutionEvento, verifyEvolutionSecret } from "./ingest";
import type { EvolutionEvento } from "./webhook";

const CONECTADO = new Date("2026-11-17T10:00:00Z");
const DEPOIS = new Date("2026-11-17T10:05:00Z");
const BASE = { organizationId: "org-a", channelSessionId: "sess-a", connectedAt: CONECTADO };

function msg(p: Partial<Extract<EvolutionEvento, { tipo: "mensagem" }>> = {}): EvolutionEvento {
  return {
    tipo: "mensagem",
    instancia: "inst-a",
    externalId: "WA1",
    de: { telefone: "5511999990000", lid: null, nome: "Ana" },
    fromMe: false,
    timestamp: DEPOIS,
    texto: "oi",
    midia: null,
    ...p,
  };
}

let db: FakeDb;
beforeEach(() => {
  db = criarFakeDb();
  vi.clearAllMocks();
});

describe("verifyEvolutionSecret", () => {
  const SEGREDO = "s".repeat(24);
  const h = (v?: string) => new Headers(v === undefined ? {} : { "x-deskcomm-webhook-secret": v });
  it("aceita o header igual ao segredo da sessão", () => {
    expect(verifyEvolutionSecret(h(SEGREDO), SEGREDO)).toBe(true);
  });
  it("recusa ausente, errado, de outro tamanho e segredo curto", () => {
    expect(verifyEvolutionSecret(h(), SEGREDO)).toBe(false);
    expect(verifyEvolutionSecret(h("x".repeat(24)), SEGREDO)).toBe(false);
    expect(verifyEvolutionSecret(h(SEGREDO + "x"), SEGREDO)).toBe(false);
    expect(verifyEvolutionSecret(h("curto"), "curto")).toBe(false);
    expect(verifyEvolutionSecret(h(SEGREDO), null)).toBe(false);
  });
});

describe("mensagem de entrada", () => {
  it("texto novo cria contato, conversa e mensagem inbound", async () => {
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg() });
    expect(r.status).toBe("ingested");
    expect(db.rpcs.find((x) => x.name === "fn_upsert_wa_contact")?.args).toMatchObject({
      p_org: "org-a",
      p_kind: "phone",
      p_lid: null,
    });
    expect(db.tables.messages!).toHaveLength(1);
    expect(db.tables.messages![0]!).toMatchObject({
      organization_id: "org-a",
      conversation_id: "conv-org-a",
      channel_session_id: "sess-a",
      external_id: "WA1",
      direction: "inbound",
      body: "oi",
      type: "text",
    });
    expect(db.rpcs.some((x) => x.name === "fn_mark_conversation_message")).toBe(true);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledTimes(1);
  });

  it("mesmo externalId duas vezes grava uma linha só", async () => {
    await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg() });
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg() });
    expect(r).toMatchObject({ status: "ignored", reason: "duplicada" });
    expect(db.tables.messages!).toHaveLength(1);
    expect(aplicarEfeitosPosEntrada).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["anterior à conexão", { timestamp: new Date("2026-11-17T09:00:00Z") }, CONECTADO],
    ["sem timestamp", { timestamp: null }, CONECTADO],
    ["sessão sem connectedAt", {}, null],
  ])("histórico (%s) é ignorado", async (_n, p, connectedAt) => {
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, connectedAt, evento: msg(p) });
    expect(r).toEqual({ status: "ignored", reason: "historico" });
    expect(db.tables.messages!).toHaveLength(0);
    expect(db.rpcs).toHaveLength(0);
  });

  it("fromMe vira outbound eco, sem efeitos de entrada", async () => {
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg({ fromMe: true }) });
    expect(r.status).toBe("ingested");
    expect(db.tables.messages![0]!).toMatchObject({ direction: "outbound", sent_via: "external_device" });
    expect(aplicarEfeitosPosEntrada).not.toHaveBeenCalled();
  });

  it("fromMe do que o CRM já enviou casa por external_id e não duplica", async () => {
    db.tables.messages!.push({
      id: "crm-1",
      organization_id: "org-a",
      external_id: "WA1",
      direction: "outbound",
      sent_via: "crm",
    });
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg({ fromMe: true }) });
    expect(r).toMatchObject({ status: "ignored", reason: "duplicada" });
    expect(db.tables.messages!).toHaveLength(1);
  });

  it("eco do envio em voo (linha nossa ainda sem external_id) não duplica nem pausa a IA", async () => {
    db.tables.messages!.push({
      id: "crm-voo",
      organization_id: "org-a",
      conversation_id: "conv-org-a",
      external_id: null,
      direction: "outbound",
      sent_via: "ai",
      status: "sending",
      type: "text",
      body: "oi",
      created_at: new Date().toISOString(),
    });
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg({ fromMe: true }) });
    expect(r).toMatchObject({ status: "ignored", reason: "eco_de_envio_em_voo" });
    expect(db.tables.messages!).toHaveLength(1);
    expect(pausarIaPorAtendimentoManual).not.toHaveBeenCalled();
  });

  it("fromMe digitado no celular (sem envio em voo que case) grava e pausa a IA", async () => {
    db.tables.messages!.push({
      id: "crm-voo",
      organization_id: "org-a",
      conversation_id: "conv-org-a",
      external_id: null,
      direction: "outbound",
      sent_via: "ai",
      status: "sending",
      type: "text",
      body: "outro texto",
      created_at: new Date().toISOString(),
    });
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg({ fromMe: true }) });
    expect(r).toMatchObject({ status: "ingested", reason: "outbound" });
    expect(db.tables.messages!).toHaveLength(2);
    expect(pausarIaPorAtendimentoManual).toHaveBeenCalledTimes(1);
  });

  it("mídia enviada do celular enquanto um TEXTO do CRM está em voo não é tomada por eco", async () => {
    db.tables.messages!.push({
      id: "crm-voo",
      organization_id: "org-a",
      conversation_id: "conv-org-a",
      external_id: null,
      direction: "outbound",
      sent_via: "ai",
      status: "sending",
      type: "text",
      body: "oi",
      created_at: new Date().toISOString(),
    });
    const r = await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: msg({
        fromMe: true,
        texto: null,
        midia: { tipo: "image", mimetype: "image/jpeg", base64: Buffer.from("abc").toString("base64"), nomeArquivo: null },
      }),
    });
    expect(r).toMatchObject({ status: "ingested" });
    expect(pausarIaPorAtendimentoManual).toHaveBeenCalledTimes(1);
  });

  it("lid sem telefone segue a regra do WAHA: âncora lid, telefone nulo", async () => {
    await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: msg({ de: { telefone: null, lid: "250302204792918@lid", nome: null } }),
    });
    expect(db.rpcs.find((x) => x.name === "fn_upsert_wa_contact")?.args).toMatchObject({
      p_kind: "lid",
      p_lid: "250302204792918",
      p_phone: null,
    });
  });

  it("lid com telefone alternativo grava os dois", async () => {
    await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: msg({ de: { telefone: "5511999990000", lid: "250302204792918@lid", nome: null } }),
    });
    const args = db.rpcs.find((x) => x.name === "fn_upsert_wa_contact")?.args;
    expect(args).toMatchObject({ p_kind: "lid", p_lid: "250302204792918" });
    expect(args?.p_phone).toBeTruthy();
  });

  it("mídia base64 vai para o bucket whatsapp-media e pede a derivação", async () => {
    const r = await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: msg({
        texto: null,
        midia: { tipo: "image", mimetype: "image/jpeg", base64: Buffer.from("abc").toString("base64"), nomeArquivo: null },
      }),
    });
    expect(r.status).toBe("ingested");
    expect(db.uploads).toEqual([
      expect.objectContaining({ bucket: "whatsapp-media", bytes: 3, contentType: "image/jpeg" }),
    ]);
    expect(db.uploads[0]!.path.startsWith("org-a/conv-org-a/")).toBe(true);
    expect(db.tables.messages![0]!).toMatchObject({
      type: "image",
      media_mime: "image/jpeg",
      media_size_bytes: 3,
      media_storage_path: db.uploads[0]!.path,
    });
    expect(db.rpcs.find((x) => x.name === "emit_event")?.args).toMatchObject({
      p_event_type: "media.derive_requested",
    });
  });
});

describe("correções da revisão", () => {
  const imagem = (base64: string | null) =>
    msg({ texto: null, midia: { tipo: "image", mimetype: "image/jpeg", base64, nomeArquivo: null } });

  it("mídia acima de MAX_MEDIA_BYTES não sobe; mensagem entra com media failed e motivo", async () => {
    const grande = "A".repeat(Math.ceil(((MAX_MEDIA_BYTES + 3) * 4) / 3));
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: imagem(grande) });
    expect(r.status).toBe("ingested");
    expect(db.uploads).toHaveLength(0);
    const m = db.tables.messages![0]!;
    expect((m.metadata as Record<string, unknown>).media_status).toBe("failed");
    expect(String((m.metadata as Record<string, unknown>).media_derived_motivo)).toMatch(/limite/);
  });

  it("marcar a mídia preserva o metadata que já existia (file_name)", async () => {
    await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: msg({ texto: null, midia: { tipo: "document", mimetype: "application/pdf", base64: "YWJj", nomeArquivo: "a.pdf" } }),
    });
    expect(db.tables.messages![0]!.metadata).toMatchObject({ file_name: "a.pdf", media_status: "stored" });
  });

  it("reentrega passa a MESMA chave ao consumo do aviso interno (idempotente pela RPC)", async () => {
    vi.mocked(consumirRespostaDoSuporteNoWhatsApp).mockResolvedValue(true);
    await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg() });
    await ingestEvolutionEvento(db.admin, { ...BASE, evento: msg() });
    const chamadas = vi.mocked(consumirRespostaDoSuporteNoWhatsApp).mock.calls;
    expect(chamadas.map((c) => [c[1].channelSessionId, c[1].externalId])).toEqual([
      ["sess-a", "WA1"],
      ["sess-a", "WA1"],
    ]);
    expect(db.tables.messages).toHaveLength(0);
    vi.mocked(consumirRespostaDoSuporteNoWhatsApp).mockResolvedValue(false);
  });

  it("failed não é sobrescrito por status atrasado", async () => {
    db.tables.messages!.push({ id: "m1", organization_id: "org-a", channel_session_id: "sess-a", external_id: "WA1", status: "failed" });
    await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: { tipo: "status", instancia: "inst-a", externalId: "WA1", status: "delivered" },
    });
    expect(db.tables.messages![0]!.status).toBe("failed");
  });

  it("evento de conexão não mexe em channel_sessions (last_status_change_at fica)", async () => {
    db.tables.channel_sessions = [
      { id: "sess-a", organization_id: "org-a", status: "WORKING", last_status_change_at: "2026-11-17T10:00:00Z" },
    ];
    await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: { tipo: "conexao", instancia: "inst-a", estado: "open", telefone: null },
    });
    expect(db.tables.channel_sessions[0]!.last_status_change_at).toBe("2026-11-17T10:00:00Z");
  });
});

describe("status", () => {
  const status = (s: "delivered" | "read"): EvolutionEvento => ({
    tipo: "status",
    instancia: "inst-a",
    externalId: "WA1",
    status: s,
  });

  it("read não é rebaixado por delivered atrasado", async () => {
    db.tables.messages!.push({ id: "m1", organization_id: "org-a", channel_session_id: "sess-a", external_id: "WA1", status: "sent" });
    await ingestEvolutionEvento(db.admin, { ...BASE, evento: status("read") });
    expect(db.tables.messages![0]!.status).toBe("read");
    await ingestEvolutionEvento(db.admin, { ...BASE, evento: status("delivered") });
    expect(db.tables.messages![0]!.status).toBe("read");
  });

  it("não toca mensagem de outra organização com o mesmo external_id", async () => {
    db.tables.messages!.push({ id: "m1", organization_id: "org-b", channel_session_id: "sess-b", external_id: "WA1", status: "sent" });
    const r = await ingestEvolutionEvento(db.admin, { ...BASE, evento: status("read") });
    expect(r.status).toBe("ignored");
    expect(db.tables.messages![0]!.status).toBe("sent");
  });
});

describe("conexão e QR", () => {
  it("conexao delega para o vigia de saúde", async () => {
    const r = await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: { tipo: "conexao", instancia: "inst-a", estado: "close", telefone: null },
    });
    expect(r.status).toBe("ingested");
    expect(vi.mocked(sincronizarSaudeDaConexao).mock.calls[0]![2]).toMatchObject({ status: "STOPPED" });
  });

  it("evento ignorado pelo parser volta ignored com o motivo", async () => {
    const r = await ingestEvolutionEvento(db.admin, {
      ...BASE,
      evento: { tipo: "ignorado", instancia: "inst-a", motivo: "grupo" },
    });
    expect(r).toEqual({ status: "ignored", reason: "grupo" });
  });
});
