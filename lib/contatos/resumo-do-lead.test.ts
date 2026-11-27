import { describe, expect, it } from "vitest";

import { LIMITE_DO_CONTEXTO, haPoucaInformacao, montarContextoDoLead, type DadosDoLead } from "./resumo-do-lead";

const BASE: DadosDoLead = {
  fuso: "America/Sao_Paulo",
  contato: { nome: "Junior Aleixo", telefone: "+5516982144380", email: null, origem: "whatsapp", criadoEm: "2026-11-19T12:00:00.000Z", tags: [], campos: { cep: "14000-000", vazio: "" } },
  anotacoes: [{ criadaEm: "2026-11-27T17:32:00.000Z", autor: "Junior", texto: "Quer orçamento para 3 unidades", kind: "audio" }],
  tarefas: [{ titulo: "Ligar de volta", status: "pending", prazo: "2026-11-29T12:00:00.000Z", descricao: null }],
  negocios: [{ titulo: "Orçamento", etapa: "Qualificando", status: "open", valorCents: 150000 }],
  agendamentos: [],
  mensagens: [
    { em: "2026-11-25T18:00:00.000Z", deQuem: "empresa", texto: "Oi Junior, tudo bem?" },
    { em: "2026-11-25T18:20:00.000Z", deQuem: "lead", texto: "Tudo, quero saber o preço" },
  ],
};

describe("montarContextoDoLead", () => {
  it("traz ficha, anotações com data local, tarefas, negócio e mensagens em ordem", () => {
    const t = montarContextoDoLead(BASE);
    expect(t).toContain("Nome: Junior Aleixo");
    expect(t).toContain("cep: 14000-000");
    expect(t).not.toContain("vazio:");
    expect(t).toMatch(/27\/11\/2026,? 14:32 · Junior · áudio: Quer orçamento/);
    expect(t).toMatch(/\[pending\] Ligar de volta · prazo 29\/11\/2026/);
    expect(t).toContain("etapa Qualificando · open · R$ 1500.00");
    expect(t.indexOf("Oi Junior")).toBeLessThan(t.indexOf("quero saber o preço"));
  });

  it("passa do limite: corta mensagens antigas, mantém anotações e as mensagens mais novas", () => {
    const mensagens = Array.from({ length: 200 }, (_, i) => ({
      em: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
      deQuem: "lead" as const,
      texto: `mensagem ${i} ` + "x".repeat(200),
    }));
    const t = montarContextoDoLead({ ...BASE, mensagens });
    expect(t.length).toBeLessThanOrEqual(LIMITE_DO_CONTEXTO);
    expect(t).toContain("Quer orçamento para 3 unidades");
    expect(t).toContain("mensagem 199 ");
    expect(t).not.toContain("mensagem 0 ");
  });

  it("contato sem nada: avisa que há pouca informação (não chama a IA)", () => {
    expect(haPoucaInformacao({ ...BASE, anotacoes: [], tarefas: [], negocios: [], mensagens: [] })).toBe(true);
    expect(haPoucaInformacao(BASE)).toBe(false);
  });
});
