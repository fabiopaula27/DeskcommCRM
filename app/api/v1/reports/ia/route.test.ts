import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => false }));

import { GET } from "./route";

const DIA = (dia: string, custo: number, tokens: number) => ({
  dia, chamadas: 1, custo_cents: custo, input_tokens: tokens, output_tokens: 0,
  cache_read_tokens: 0, cache_write_tokens: 0, p50_latency_ms: 0, p95_latency_ms: 0,
});

function preparar(rpc: ReturnType<typeof vi.fn>) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" },
    org: { orgId: "22222222-2222-4222-8222-222222222222", name: "Org", role: "manager" },
  } as never);
  const org = { data: { timezone: "America/Sao_Paulo" }, error: null };
  const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => org };
  vi.mocked(createClient).mockResolvedValue({ from: () => builder, rpc } as never);
}

const JANELA = "?from=2026-11-01T03:00:00.000Z&to=2026-11-03T03:00:00.000Z";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/reports/ia", () => {
  it("junta usos com o mesmo nome, preenche os dias e monta o histórico por mês", async () => {
    const rpc = vi.fn(async (_n: string, args: { p_desde: string }) => {
      const periodo = args.p_desde === "2026-11-01T03:00:00.000Z";
      return {
        data: {
          totais: { ...DIA("", 30, 300), chamadas: 3, turnos: 2, custo_dos_turnos_cents: 20 },
          dias: periodo ? [DIA("2026-11-02", 30, 300)] : [DIA("2026-10-10", 7, 70), DIA("2026-11-02", 30, 300)],
          purposes: [
            { ...DIA("", 10, 100), purpose: "proposal_assistant" },
            { ...DIA("", 10, 100), purpose: "proposal_template_import" },
            { ...DIA("", 10, 100), purpose: "agent_turn" },
          ],
          inbounds: {},
          handoffs: {},
        },
        error: null,
      };
    });
    preparar(rpc);
    const res = await GET(new NextRequest(`http://x/api/v1/reports/ia${JANELA}`));
    const d = (await res.json()).data;
    expect(d.tokens).toBe(300);
    expect(d.por_uso).toEqual([
      { uso: "Propostas", tokens: 200, custo_cents: 20, chamadas: 2 },
      { uso: "Atendimento da IA", tokens: 100, custo_cents: 10, chamadas: 1 },
    ]);
    expect(d.por_dia.map((x: { dia: string }) => x.dia)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(d.historico.find((x: { mes: string }) => x.mes === "2026-10").tokens).toBe(70);
    expect(d.custo_por_turno_cents).toBe(10);
  });

  it("uso às 23h30 do último dia (já no dia seguinte em UTC) aparece no gráfico", async () => {
    preparar(vi.fn(async () => ({
      data: {
        totais: { ...DIA("", 5, 50), turnos: 0, custo_dos_turnos_cents: 0 },
        dias: [DIA("2026-11-03", 5, 50)],
        purposes: [], inbounds: {}, handoffs: {},
      },
      error: null,
    })));
    const res = await GET(new NextRequest(`http://x/api/v1/reports/ia${JANELA}`));
    const d = (await res.json()).data;
    const soma = d.por_dia.reduce((s: number, x: { tokens: number }) => s + x.tokens, 0);
    expect(soma).toBe(d.tokens);
  });

  it("histórico tem 12 meses, sem mês anterior à janela", async () => {
    preparar(vi.fn(async () => ({
      data: {
        totais: null,
        dias: [DIA("2020-01-01", 1, 1), DIA("2026-11-02", 1, 1)],
        purposes: [], inbounds: {}, handoffs: {},
      },
      error: null,
    })));
    const res = await GET(new NextRequest(`http://x/api/v1/reports/ia${JANELA}`));
    const d = (await res.json()).data;
    expect(d.historico).toHaveLength(12);
    expect(d.historico.some((h: { mes: string }) => h.mes === "2020-01")).toBe(false);
  });

  it("período sem uso não divide por zero", async () => {
    preparar(vi.fn(async () => ({
      data: { totais: null, dias: [], purposes: [], inbounds: {}, handoffs: {} }, error: null,
    })));
    const res = await GET(new NextRequest(`http://x/api/v1/reports/ia${JANELA}`));
    const d = (await res.json()).data;
    expect(d.tokens).toBe(0);
    expect(d.custo_por_turno_cents).toBeNull();
  });
});
