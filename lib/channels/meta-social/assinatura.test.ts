import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { assinaturaValida } from "./assinatura";

const SEGREDO = "segredo-do-app";
const CORPO = '{"object":"page","entry":[]}';
const certo = "sha256=" + createHmac("sha256", SEGREDO).update(CORPO).digest("hex");

describe("assinaturaValida", () => {
  it("aceita a assinatura feita com o App Secret", () => {
    expect(assinaturaValida(CORPO, certo, SEGREDO)).toBe(true);
  });
  it("recusa corpo alterado, segredo errado e cabeçalho ausente ou torto", () => {
    expect(assinaturaValida(CORPO + " ", certo, SEGREDO)).toBe(false);
    expect(assinaturaValida(CORPO, certo, "outro")).toBe(false);
    expect(assinaturaValida(CORPO, null, SEGREDO)).toBe(false);
    expect(assinaturaValida(CORPO, "sha1=abc", SEGREDO)).toBe(false);
    expect(assinaturaValida(CORPO, certo, "")).toBe(false);
  });
});
