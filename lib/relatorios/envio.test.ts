import { describe, expect, it, vi } from "vitest";

import { enviarRelatorio, type DepsDoEnvio } from "./envio";

const periodo = { chave: "diario:2026-11-26", de: "2026-11-26", ate: "2026-11-26", from: "2026-11-26T03:00:00.000Z", to: "2026-11-27T03:00:00.000Z" };

function deps(over: Partial<DepsDoEnvio> = {}): DepsDoEnvio {
  return {
    gerarPdf: vi.fn(async () => Buffer.from("%PDF-1.4 teste")),
    enviarEmail: vi.fn(async () => ({ ok: true })),
    publicarPdf: vi.fn(async () => "https://storage/relatorio.pdf"),
    enviarWhatsapp: vi.fn(async () => undefined),
    ...over,
  };
}

describe("enviar relatório agendado", () => {
  it("manda um e-mail com o PDF anexado e um documento por telefone", async () => {
    const d = deps();
    const r = await enviarRelatorio(d, { emails: ["a@x.com", "b@x.com"], telefones: ["+5516999990000"], periodo, empresa: "Loja" });
    expect(r).toEqual({ enviado: true, falhas: [] });
    // Um e-mail por destinatário: ninguém vê o endereço dos outros.
    expect(d.enviarEmail).toHaveBeenCalledTimes(2);
    const email = vi.mocked(d.enviarEmail).mock.calls[0]![0];
    expect(email.to).toEqual(["a@x.com"]);
    expect(email.attachments[0]!.filename).toBe("relatorio-loja-2026-11-26.pdf");
    expect(d.enviarWhatsapp).toHaveBeenCalledWith("+5516999990000", "https://storage/relatorio.pdf", "relatorio-loja-2026-11-26.pdf", expect.any(String));
  });

  it("falha num destino não impede os outros e fica registrada", async () => {
    const d = deps({ enviarWhatsapp: vi.fn(async () => { throw new Error("canal desconectado"); }) });
    const r = await enviarRelatorio(d, { emails: ["a@x.com"], telefones: ["+5516999990000"], periodo, empresa: "Loja" });
    expect(r.enviado).toBe(true);
    expect(r.falhas).toEqual(["WhatsApp +5516999990000: canal desconectado"]);
  });

  it("e-mail recusado pelo provedor conta como falha", async () => {
    const d = deps({ enviarEmail: vi.fn(async () => ({ ok: false, error: "not_configured" })) });
    const r = await enviarRelatorio(d, { emails: ["a@x.com"], telefones: [], periodo, empresa: "Loja" });
    expect(r).toEqual({ enviado: false, falhas: ["E-mail a@x.com: not_configured"] });
  });

  it("sem nenhum destino não gera PDF", async () => {
    const d = deps();
    const r = await enviarRelatorio(d, { emails: [], telefones: [], periodo, empresa: "Loja" });
    expect(r).toEqual({ enviado: false, falhas: ["Nenhum e-mail ou telefone cadastrado."] });
    expect(d.gerarPdf).not.toHaveBeenCalled();
  });
});
