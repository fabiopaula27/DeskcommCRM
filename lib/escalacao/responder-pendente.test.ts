import { describe, expect, it } from "vitest";

import { deveResponderPendente } from "./responder-pendente";

describe("devolver à IA responde a mensagem pendente do cliente", () => {
  it("última do cliente: responde", () => {
    expect(deveResponderPendente({ id: "m", direction: "inbound" })).toBe(true);
  });
  it("última da equipe ou conversa vazia: espera o cliente", () => {
    expect(deveResponderPendente({ id: "m", direction: "outbound" })).toBe(false);
    expect(deveResponderPendente(null)).toBe(false);
  });
});
