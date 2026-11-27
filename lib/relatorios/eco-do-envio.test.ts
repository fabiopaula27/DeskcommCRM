import { describe, expect, it, vi } from "vitest";

import { ehEcoDoRelatorio, pareceArquivoDoRelatorio } from "./eco-do-envio";

const ORG = "22222222-2222-4222-8222-222222222222";

function db(linhas: unknown[], erro: unknown = null) {
  const q = {
    select: () => q,
    eq: vi.fn(() => q),
    gt: () => q,
    limit: async () => ({ data: linhas, error: erro }),
  };
  return { from: vi.fn(() => q) } as never;
}

describe("eco do envio do relatório", () => {
  it("só PDF com nome de relatório é candidato", () => {
    expect(pareceArquivoDoRelatorio("application/pdf", "relatorio-loja-2026-11-26.pdf")).toBe(true);
    expect(pareceArquivoDoRelatorio("application/pdf", "contrato.pdf")).toBe(false);
    expect(pareceArquivoDoRelatorio("image/jpeg", "relatorio-loja.pdf")).toBe(false);
    expect(pareceArquivoDoRelatorio("application/pdf", null)).toBe(false);
  });

  it("PDF do relatório com marca válida é eco", async () => {
    expect(await ehEcoDoRelatorio(db([{ id: 1 }]), ORG, { fromMe: true, mime: "application/pdf", nomeArquivo: "relatorio-loja-2026-11-26.pdf" })).toBe(true);
  });

  it("sem marca não é eco (o dono pode mandar um PDF com esse nome)", async () => {
    expect(await ehEcoDoRelatorio(db([]), ORG, { fromMe: true, mime: "application/pdf", nomeArquivo: "relatorio-loja-2026-11-26.pdf" })).toBe(false);
  });

  it("mensagem recebida nunca é eco", async () => {
    expect(await ehEcoDoRelatorio(db([{ id: 1 }]), ORG, { fromMe: false, mime: "application/pdf", nomeArquivo: "relatorio-loja-2026-11-26.pdf" })).toBe(false);
  });

  it("falha de leitura não descarta mensagem", async () => {
    expect(await ehEcoDoRelatorio(db([], { message: "x" }), ORG, { fromMe: true, mime: "application/pdf", nomeArquivo: "relatorio-a.pdf" })).toBe(false);
  });
});
