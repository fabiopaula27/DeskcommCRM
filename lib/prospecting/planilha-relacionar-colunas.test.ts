import { describe, expect, it } from "vitest";

import { lerPlanilhaDeProspeccao, sugerirDestino } from "@/lib/prospecting/planilha";

const personalizados = [
  { key: "faturamento", label: "Faturamento" },
  { key: "qtd_lojas", label: "Quantidade de lojas" },
];

describe("relacionar colunas da planilha", () => {
  it("sugere campo fixo pelo título e campo personalizado pelo rótulo", () => {
    expect(sugerirDestino("Telefone", personalizados)).toBe("phone");
    expect(sugerirDestino("faturamento", personalizados)).toBe("cf:faturamento");
    expect(sugerirDestino("Quantidade de Lojas", personalizados)).toBe("cf:qtd_lojas");
    expect(sugerirDestino("Observação", personalizados)).toBe("ignorar");
  });

  it("sem mapa: leva o campo personalizado reconhecido e devolve as colunas com exemplo", () => {
    const r = lerPlanilhaDeProspeccao(
      {
        headers: ["Empresa", "Telefone", "Faturamento", "Observação"],
        rows: [["Vidraçaria X", "(16) 99696-2600", "50 mil", "ligar de manhã"]],
      },
      { personalizados },
    );
    if ("erro" in r) throw new Error(r.erro);
    expect(r.candidatos[0]?.prospect.custom_fields).toEqual({ faturamento: "50 mil" });
    expect(r.colunas.map((c) => c.destino)).toEqual(["name", "phone", "cf:faturamento", "ignorar"]);
    expect(r.colunas[2]?.exemplo).toBe("50 mil");
  });

  it("com mapa: o operador manda — coluna de título desconhecido vira nome, e-mail e campo", () => {
    const r = lerPlanilhaDeProspeccao(
      {
        headers: ["Cliente", "Zap", "Contato", "Lojas"],
        rows: [["Vidraçaria Y", "16996962600", "a@b.com", "3"]],
      },
      { personalizados, mapa: ["name", "phone", "emails", "cf:qtd_lojas"] },
    );
    if ("erro" in r) throw new Error(r.erro);
    const p = r.candidatos[0]?.prospect;
    expect(p?.name).toBe("Vidraçaria Y");
    expect(p?.emails).toEqual(["a@b.com"]);
    expect(p?.custom_fields).toEqual({ qtd_lojas: "3" });
  });

  it("coluna TAGS: reconhecida sozinha e dividida por vírgula ou ponto e vírgula", () => {
    const r = lerPlanilhaDeProspeccao({
      headers: ["NOME", "Telefone", "TAGS"],
      rows: [["Josmir", "16996962600", "Lead-vidracaria, Batatais; quente"]],
    });
    if ("erro" in r) throw new Error(r.erro);
    expect(r.colunas.map((c) => c.destino)).toEqual(["name", "phone", "tags"]);
    expect(r.candidatos[0]?.prospect.tags).toEqual(["Lead-vidracaria", "Batatais", "quente"]);
  });

  it("com mapa sem telefone: recusa e devolve as colunas para a tela corrigir", () => {
    const r = lerPlanilhaDeProspeccao(
      { headers: ["Empresa", "Telefone"], rows: [["X", "16996962600"]] },
      { mapa: ["name", "ignorar"] },
    );
    expect("erro" in r).toBe(true);
    if ("erro" in r) expect(r.colunas?.length).toBe(2);
  });

  it("com mapa: campo personalizado que a organização não tem vira 'ignorar'", () => {
    const r = lerPlanilhaDeProspeccao(
      { headers: ["Empresa", "Telefone", "X"], rows: [["Emp", "16996962600", "v"]] },
      { personalizados, mapa: ["name", "phone", "cf:inexistente"] },
    );
    if ("erro" in r) throw new Error(r.erro);
    expect(r.colunas[2]?.destino).toBe("ignorar");
    expect(r.candidatos[0]?.prospect.custom_fields).toBeUndefined();
  });
});
