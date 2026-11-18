import { describe, expect, it } from "vitest";

import { chaveDaVersao, lerListaDeOcultas } from "@/lib/extensions/ocultas";
import { CORES_DAS_ETAPAS, corSugerida, ehCorDeEtapa } from "@/lib/leads/cores-das-etapas";
import { normalizarProposta } from "@/lib/onboarding/proposta-de-funil";

describe("cores das etapas", () => {
  it("toda cor pronta passa no CHECK do banco e vizinhas são diferentes", () => {
    for (const c of CORES_DAS_ETAPAS) expect(ehCorDeEtapa(c.cor)).toBe(true);
    for (let i = 0; i < 20; i++) expect(corSugerida(i)).not.toBe(corSugerida(i + 1));
  });

  it("o wizard guarda a cor válida e descarta a inválida", () => {
    const p = normalizarProposta({
      nome: "Vendas",
      etapas: [
        { nome: "Novo", passo: null, cor: "#3b82f6" },
        { nome: "Proposta", passo: null, cor: "vermelho" },
      ],
    });
    expect(p.etapas[0]?.cor).toBe("#3b82f6");
    expect(p.etapas[1]?.cor).toBeUndefined();
  });
});

describe("versões ocultas do catálogo", () => {
  it("a chave identifica catálogo + publicador + nome + versão", () => {
    expect(chaveDaVersao("c1", { publisher: "solutcrm", name: "tema-violeta", version: "1.0.0" })).toBe(
      "c1|solutcrm|tema-violeta|1.0.0",
    );
  });

  it("lista ilegível ou vazia não esconde nada", () => {
    expect(lerListaDeOcultas(null)).toEqual([]);
    expect(lerListaDeOcultas("lixo")).toEqual([]);
    expect(lerListaDeOcultas('["a", 2, "b"]')).toEqual(["a", "b"]);
  });
});
