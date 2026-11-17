import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lerEventoEvolution, type EvolutionEvento } from "./webhook";

const fx = (nome: string) => readFileSync(join(__dirname, "__fixtures__", `${nome}.json`), "utf8");
const ler = (nome: string): EvolutionEvento => {
  const r = lerEventoEvolution(fx(nome));
  if (!r.ok) throw new Error(`falhou: ${r.motivo} ${r.campos.join(",")}`);
  return r.evento;
};

describe("lerEventoEvolution", () => {
  it("texto", () => {
    const e = ler("messages-upsert-text");
    expect(e.tipo).toBe("mensagem");
    if (e.tipo !== "mensagem") return;
    expect(e.texto).toBe("Olá, preciso de ajuda");
    expect(e.de.telefone).toBe("5511999990001");
    expect(e.de.nome).toBe("Contato Teste");
    expect(e.fromMe).toBe(false);
    expect(e.externalId).toBe("3EB0A1B2C3D4E5F60001");
    expect(e.timestamp?.getTime()).toBe(1763298000 * 1000);
    expect(e.midia).toBeNull();
  });

  it("imagem com base64 e legenda", () => {
    const e = ler("messages-upsert-image");
    if (e.tipo !== "mensagem") throw new Error("tipo");
    expect(e.midia?.tipo).toBe("image");
    expect(e.midia?.base64).not.toBeNull();
    expect(e.midia?.mimetype).toBe("image/jpeg");
    expect(e.texto).toBe("Foto de teste");
  });

  it("audio e documento", () => {
    const a = ler("messages-upsert-audio");
    if (a.tipo !== "mensagem") throw new Error("tipo");
    expect(a.midia?.tipo).toBe("audio");
    const d = ler("messages-upsert-document");
    if (d.tipo !== "mensagem") throw new Error("tipo");
    expect(d.midia?.tipo).toBe("document");
    expect(d.midia?.nomeArquivo).toBe("contrato.pdf");
  });

  it("aceita base64 em data.base64", () => {
    const o = JSON.parse(fx("messages-upsert-image"));
    const b64 = o.data.message.base64;
    delete o.data.message.base64;
    o.data.base64 = b64;
    const r = lerEventoEvolution(JSON.stringify(o));
    expect(r.ok && r.evento.tipo === "mensagem" && r.evento.midia?.base64).toBe(b64);
  });

  it("fromMe", () => {
    const e = ler("messages-upsert-fromme");
    expect(e.tipo === "mensagem" && e.fromMe).toBe(true);
  });

  it("remoteJid @lid vira lid sem telefone", () => {
    const o = JSON.parse(fx("messages-upsert-text"));
    o.data.key.remoteJid = "99887766@lid";
    const r = lerEventoEvolution(JSON.stringify(o));
    expect(r.ok && r.evento.tipo === "mensagem" && r.evento.de).toMatchObject({
      telefone: null,
      lid: "99887766@lid",
    });
  });

  it("grupo e broadcast ignorados", () => {
    expect(ler("messages-upsert-group")).toMatchObject({ tipo: "ignorado", motivo: "grupo" });
    const o = JSON.parse(fx("messages-upsert-text"));
    o.data.key.remoteJid = "status@broadcast";
    const r = lerEventoEvolution(JSON.stringify(o));
    expect(r.ok && r.evento).toMatchObject({ tipo: "ignorado", motivo: "broadcast" });
  });

  it("ack", () => {
    expect(ler("messages-update-ack")).toMatchObject({
      tipo: "status",
      externalId: "3EB0A1B2C3D4E5F60005",
      status: "read",
    });
  });

  it("conexao", () => {
    expect(ler("connection-update-open")).toMatchObject({
      tipo: "conexao",
      estado: "open",
      telefone: "5511999990000",
    });
    expect(ler("connection-update-close")).toMatchObject({ tipo: "conexao", estado: "close" });
  });

  it("qr", () => {
    const e = ler("qrcode-updated");
    expect(e.tipo === "qr" && e.qrBase64.length).toBeGreaterThan(10);
  });

  it("aceita nome de evento em maiusculas com underscore", () => {
    const o = JSON.parse(fx("qrcode-updated"));
    o.event = "QRCODE_UPDATED";
    const r = lerEventoEvolution(JSON.stringify(o));
    expect(r.ok && r.evento.tipo).toBe("qr");
  });

  it("evento desconhecido e ignorado", () => {
    const o = JSON.parse(fx("qrcode-updated"));
    o.event = "presence.update";
    const r = lerEventoEvolution(JSON.stringify(o));
    expect(r.ok && r.evento).toMatchObject({ tipo: "ignorado", motivo: "evento_sem_interesse" });
  });

  it("json quebrado", () => {
    expect(lerEventoEvolution("{nao")).toEqual({ ok: false, motivo: "json_invalido", campos: [] });
  });

  it("instance numerico viola contrato e nomeia o campo", () => {
    const o = JSON.parse(fx("messages-upsert-text"));
    o.instance = 42;
    const r = lerEventoEvolution(JSON.stringify(o));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("contrato");
      expect(r.campos).toContain("instance");
      expect(JSON.stringify(r)).not.toContain("42");
    }
  });

  it("timestamp ausente ou invalido vira null", () => {
    for (const v of [undefined, "abc", 0, -5]) {
      const o = JSON.parse(fx("messages-upsert-text"));
      if (v === undefined) delete o.data.messageTimestamp;
      else o.data.messageTimestamp = v;
      const r = lerEventoEvolution(JSON.stringify(o));
      expect(r.ok && r.evento.tipo === "mensagem" && r.evento.timestamp).toBeNull();
    }
  });

  it("status PLAYED e ERROR", () => {
    for (const [bruto, esperado] of [["PLAYED", "read"], ["ERROR", "failed"]] as const) {
      const o = JSON.parse(fx("messages-update-ack"));
      o.data.status = bruto;
      const r = lerEventoEvolution(JSON.stringify(o));
      expect(r.ok && r.evento).toMatchObject({ tipo: "status", status: esperado });
    }
  });
});
