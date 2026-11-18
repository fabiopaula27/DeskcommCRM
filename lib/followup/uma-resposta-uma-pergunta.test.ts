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

import { pisoDaPergunta } from "@/lib/followup/aplicar-inbound";
import { pisoDoInboundDaEspera } from "@/lib/followup/node-handlers";

describe("relógio da VPS atrás do banco", () => {
  // O "3" foi gravado pelo banco às 12:19:39.49; a pergunta seguinte estacionou
  // às 12:19:41.29 no relógio do banco, mas a VPS (3 s atrás) gravou
  // updated_at = 12:19:38.29 — e o "3" passava como resposta dela.
  const respostaDoMenu = "2026-11-18T12:19:39.492Z";
  const updatedAtDaVps = "2026-11-18T12:19:38.290Z";
  const esperaNoBanco = "2026-11-18T12:19:41.291Z";

  it("o piso usa o mais tarde entre VPS e banco", () => {
    expect(pisoDaPergunta(updatedAtDaVps, esperaNoBanco)).toBe(esperaNoBanco);
    expect(inboundEhDestaPergunta(respostaDoMenu, pisoDaPergunta(updatedAtDaVps, esperaNoBanco))).toBe(false);
    expect(pisoDaPergunta(updatedAtDaVps, null)).toBe(updatedAtDaVps);
  });

  it("o piso da leitura da última resposta vem do created_at do wait_started", () => {
    const node = {
      id: "m11",
      type: "match_reply",
      label: "x",
      position: { x: 0, y: 0 },
      config: { branches: [], grace_timeout_ms: 900_000 },
    } as unknown as Parameters<typeof pisoDoInboundDaEspera>[0];
    const piso = pisoDoInboundDaEspera(
      node,
      [
        {
          node_id: "m11",
          idempotency_key: "m11:6",
          event_type: "wait_started",
          payload: { next_eval_at: "2026-11-18T12:34:38.290Z" },
          created_at: esperaNoBanco,
        },
      ],
      updatedAtDaVps,
    );
    expect(piso).toBe(esperaNoBanco);
  });
});
