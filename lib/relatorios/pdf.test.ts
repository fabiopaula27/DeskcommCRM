import { describe, expect, it, vi } from "vitest";

import { coletarDadosDoPdf } from "./coletar";
import { gerarPdfDoRelatorio } from "./pdf";

const args = {
  orgId: "22222222-2222-4222-8222-222222222222",
  tz: "America/Sao_Paulo",
  from: new Date("2026-11-26T03:00:00.000Z"),
  to: new Date("2026-11-27T03:00:00.000Z"),
  de: "2026-11-26",
  ate: "2026-11-26",
};

describe("PDF do relatório", () => {
  it("seção cuja função falha vira null; as outras seguem", async () => {
    const rpc = vi.fn(async (nome: string) =>
      nome === "fn_relatorio_leads"
        ? { data: { leads_total: 5, convertidos: 1, vendas_total: 1, receita_cents: 1000, leads_por_dia: [], origens: [], vendedores: [{ user_id: "u1", leads: 5, vendas: 1, receita_cents: 1000 }] }, error: null }
        : { data: null, error: { code: "PGRST202" } },
    );
    const d = await coletarDadosDoPdf({ rpc } as never, args, async () => new Map([["u1", "Ana"]]));
    expect(d.atendimento).toBeNull();
    expect(d.leads?.vendedores[0]?.nome).toBe("Ana");
  });

  it("gera um arquivo PDF válido mesmo com seções vazias", async () => {
    const buf = await gerarPdfDoRelatorio(
      {
        periodo: { de: "2026-11-26", ate: "2026-11-26" },
        atendimento: {
          conversas: 3, ativas: 1, pausadas: 0, primeira_resposta_s: 90, enviadas: 10, enviadas_ia: 4, recebidas: 6,
          por_dia: [{ dia: "2026-11-26", total: 3 }], canais: [], atendentes: [{ nome: "Ana", conversas: 3, mensagens: 6, vendas: 0 }],
        },
        leads: null, funil: { funis: [] }, metas: null, templates: null, ia: { tokens: 0, custo_cents: 0, turnos: 0 },
      },
      { empresa: "Empresa Teste", sistema: "SOLUTCRM", moeda: "BRL" },
    );
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(1000);
  }, 30_000);
});
