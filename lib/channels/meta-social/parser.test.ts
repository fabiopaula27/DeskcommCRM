import { describe, expect, it } from "vitest";

import { paraMensagemDoIngest, parsearEventos } from "./parser";

const PAGINA = "1111";
const LEAD = "9999";

const messenger = (message: Record<string, unknown>, sender = LEAD, recipient = PAGINA) => ({
  object: "page",
  entry: [{ id: PAGINA, time: 1, messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: 1764252000000, message }] }],
});

describe("parsearEventos", () => {
  it("Messenger texto vira evento do lead", () => {
    const [e] = parsearEventos(messenger({ mid: "m.1", text: "Oi, quero orçamento" }));
    expect(e).toMatchObject({ plataforma: "facebook", contaId: PAGINA, leadId: LEAD, mid: "m.1", texto: "Oi, quero orçamento", eco: false });
    expect(e?.em).toBe(new Date(1764252000000).toISOString());
  });

  it("Messenger imagem traz o anexo", () => {
    const [e] = parsearEventos(messenger({ mid: "m.2", attachments: [{ type: "image", payload: { url: "https://cdn.fb/x.jpg" } }] }));
    expect(e?.anexos).toEqual([{ type: "image", url: "https://cdn.fb/x.jpg" }]);
    expect(e?.texto).toBeNull();
  });

  it("Instagram texto usa a conta IG como conta", () => {
    const [e] = parsearEventos({
      object: "instagram",
      entry: [{ id: "IG1", time: 1, messaging: [{ sender: { id: "IGLEAD" }, recipient: { id: "IG1" }, timestamp: 1, message: { mid: "ig.1", text: "oi" } }] }],
    });
    expect(e).toMatchObject({ plataforma: "instagram", contaId: "IG1", leadId: "IGLEAD", texto: "oi" });
  });

  it("eco (mensagem da própria página) marca eco e o lead é o DESTINATÁRIO", () => {
    const [e] = parsearEventos(messenger({ mid: "m.3", text: "Olá!", is_echo: true }, PAGINA, LEAD));
    expect(e).toMatchObject({ eco: true, leadId: LEAD });
  });

  it("leitura, entrega e reação são ignorados; objeto desconhecido também", () => {
    expect(parsearEventos({ object: "page", entry: [{ id: PAGINA, messaging: [{ sender: { id: LEAD }, recipient: { id: PAGINA }, read: { watermark: 1 } }] }] })).toEqual([]);
    expect(parsearEventos({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parsearEventos("lixo")).toEqual([]);
  });

  it("referral de anúncio é repassado cru", () => {
    const p = messenger({ mid: "m.4", text: "vim do anúncio" });
    (p.entry[0]!.messaging[0] as Record<string, unknown>).referral = { source: "ADS", ad_id: "123" };
    expect(parsearEventos(p)[0]?.referral).toEqual({ source: "ADS", ad_id: "123" });
  });
});

describe("paraMensagemDoIngest", () => {
  it("monta a mensagem social com thread = id do lead e id externo por conta", () => {
    const [e] = parsearEventos(messenger({ mid: "m.1", text: "Oi" }));
    const m = paraMensagemDoIngest(e!);
    expect(m).toMatchObject({
      platform: "facebook",
      participantId: LEAD,
      accountId: PAGINA,
      conversationId: LEAD,
      externalId: `social:${PAGINA}:m.1`,
      direction: "inbound",
      kind: "message",
      text: "Oi",
    });
    expect(m.identity.anchor).toBeNull();
  });

  it("eco vira saída (não dispara a IA como mensagem do lead)", () => {
    const [e] = parsearEventos(messenger({ mid: "m.3", text: "Olá!", is_echo: true }, PAGINA, LEAD));
    expect(paraMensagemDoIngest(e!).direction).toBe("outbound");
  });
});
