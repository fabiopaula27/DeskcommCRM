import { describe, expect, it } from "vitest";

import {
  avaliarCampoDoContato,
  patchDoContato,
  valorParaGravar,
  type FichaDoContato,
} from "@/lib/followup/campo-do-contato";
import { conditionCheckSchema, flowNodeSchema } from "@/lib/followup/graph-schema";
import { evaluateCondition } from "@/lib/followup/node-handlers";

const ficha: FichaDoContato = {
  fixos: { name: "Junior Aleixo", email: null, city: "São Paulo" },
  personalizados: { produto: "Box para banheiro", vazio: "" },
};

describe("condição: campo do contato", () => {
  it("compara campo geral e personalizado sem ligar para maiúscula e acento", () => {
    expect(avaliarCampoDoContato(ficha, "city", "eq", "sao paulo")).toBe(true);
    expect(avaliarCampoDoContato(ficha, "cf:produto", "contains", "box")).toBe(true);
    expect(avaliarCampoDoContato(ficha, "cf:produto", "neq", "Cobertura")).toBe(true);
  });

  it("preenchido / vazio; vazio não prova 'é diferente de'", () => {
    expect(avaliarCampoDoContato(ficha, "email", "vazio", "")).toBe(true);
    expect(avaliarCampoDoContato(ficha, "name", "preenchido", "")).toBe(true);
    expect(avaliarCampoDoContato(ficha, "cf:vazio", "vazio", "")).toBe(true);
    expect(avaliarCampoDoContato(ficha, "email", "neq", "x@y.com")).toBe(false);
  });

  it("entra no nó de condição pelo motor", () => {
    const lead = { lead_stage: null, tags: [], steps_taken: 0, last_outcome: null, contato: ficha };
    const sim = evaluateCondition(
      { combinator: "and", checks: [{ field: "contact_field", key: "cf:produto", op: "eq", value: "box para banheiro" }] },
      lead,
      new Date(),
    );
    expect(sim).toBe(true);
  });

  it("schema: preenchido/vazio só valem para campo do contato", () => {
    expect(conditionCheckSchema.safeParse({ field: "contact_field", key: "name", op: "vazio", value: "" }).success).toBe(true);
    expect(conditionCheckSchema.safeParse({ field: "tag", op: "vazio", value: "" }).success).toBe(false);
    expect(conditionCheckSchema.safeParse({ field: "contact_field", key: "name", op: "gte", value: "1" }).success).toBe(false);
  });
});

describe("nó Preencher campo", () => {
  it("valor fixo com variável, última resposta e 'manter o que já tem'", () => {
    expect(
      valorParaGravar({ config: { alvo: "cf:produto", fonte: "fixo", valor: "Lead {primeiro_nome}" }, ficha, ultimaResposta: null }),
    ).toBe("Lead Junior");
    expect(
      valorParaGravar({ config: { alvo: "email", fonte: "ultima_resposta" }, ficha, ultimaResposta: "  a@b.com " }),
    ).toBe("a@b.com");
    expect(
      valorParaGravar({ config: { alvo: "cf:produto", fonte: "fixo", valor: "Outro", se_ja_tiver: "manter" }, ficha, ultimaResposta: null }),
    ).toBeNull();
    expect(valorParaGravar({ config: { alvo: "phone_number", fonte: "fixo", valor: "1" }, ficha, ultimaResposta: null })).toBeNull();
  });

  it("patch: coluna fixa direto, personalizado preserva os outros campos", () => {
    expect(patchDoContato("city", "Batatais", {})).toEqual({ city: "Batatais" });
    expect(patchDoContato("cf:produto", "Cobertura", { outro: 1 })).toEqual({ custom_fields: { outro: 1, produto: "Cobertura" } });
    expect(patchDoContato("phone_number", "1", {})).toBeNull();
  });

  it("o grafo aceita o nó novo", () => {
    const r = flowNodeSchema.safeParse(
        {
          id: "p",
          type: "set_contact_field",
          label: "Preencher campo",
          position: { x: 0, y: 1 },
          config: { alvo: "cf:produto", fonte: "fixo", valor: "Box", se_ja_tiver: "sobrescrever" },
        },
    );
    expect(r.success ? true : JSON.stringify(r.error.issues)).toBe(true);
  });
});
