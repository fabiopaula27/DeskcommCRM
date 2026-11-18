import { describe, expect, it } from "vitest";

import { inboundEhDestaPergunta, instanteDaMensagem } from "@/lib/followup/aplicar-inbound";

describe("uma resposta do lead vale para uma pergunta só", () => {
  // Medido em produção: o lead respondeu "3" ao menu às 08:14, o WhatsApp
  // carimbou a mensagem 2 s à frente do servidor, e a pergunta seguinte
  // (que começou a esperar 1 s depois da gravação) aceitou o mesmo "3".
  const gravadaNoServidor = "2026-11-18T11:14:18.000Z";
  const carimboDoWhatsapp = "2026-11-18T11:14:20+00:00";
  const segundaPerguntaEsperaDesde = "2026-11-18T11:14:19.200+00:00";

  it("usa o instante mais cedo entre WhatsApp e servidor", () => {
    expect(instanteDaMensagem(carimboDoWhatsapp, gravadaNoServidor)).toBe(gravadaNoServidor);
    expect(instanteDaMensagem(null, gravadaNoServidor)).toBe(gravadaNoServidor);
    expect(instanteDaMensagem("lixo", null)).toBeNull();
  });

  it("a resposta do menu não responde a pergunta seguinte", () => {
    const instante = instanteDaMensagem(carimboDoWhatsapp, gravadaNoServidor)!;
    expect(inboundEhDestaPergunta(instante, segundaPerguntaEsperaDesde)).toBe(false);
  });

  it("compara instante, não texto ('Z' contra '+00:00')", () => {
    expect(inboundEhDestaPergunta("2026-11-18T11:14:20Z", "2026-11-18T11:14:19.900+00:00")).toBe(true);
    expect(inboundEhDestaPergunta("2026-11-18T11:14:19Z", "2026-11-18T11:14:19.900+00:00")).toBe(false);
  });
});
