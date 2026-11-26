import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => false }));

import { GET as getTemplates } from "./route";
import { GET as getMetas } from "../metas/route";

function preparar(rpc: (nome: string) => { data: unknown; error: unknown }) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" },
    org: { orgId: "22222222-2222-4222-8222-222222222222", name: "Org", role: "manager" },
  } as never);
  const org = { data: { timezone: "America/Sao_Paulo" }, error: null };
  const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => org };
  vi.mocked(createClient).mockResolvedValue({ from: () => builder, rpc: vi.fn(async (n: string) => rpc(n)) } as never);
}

const JANELA = "?from=2026-11-01T03:00:00.000Z&to=2026-11-03T03:00:00.000Z";

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/reports/templates", () => {
  it("calcula o gasto estimado pela categoria e preenche os dias", async () => {
    preparar(() => ({
      data: {
        enviados: 10,
        respondidos: 4,
        por_dia: [{ dia: "2026-11-02", enviados: 10, respondidos: 4 }],
        por_template: [{ nome: "boas_vindas", categoria: "MARKETING", enviados: 10, respondidos: 4 }],
        nomes: ["boas_vindas"],
      },
      error: null,
    }));
    const res = await getTemplates(new NextRequest(`http://x/api/v1/reports/templates${JANELA}`));
    const corpo = await res.json();
    expect(corpo.data.gasto_estimado_usd).toBeCloseTo(0.625, 6);
    expect(corpo.data.por_dia).toHaveLength(2);
  });

  it("sem a migration 9112 avisa", async () => {
    preparar(() => ({ data: null, error: { code: "PGRST202" } }));
    const res = await getTemplates(new NextRequest(`http://x/api/v1/reports/templates${JANELA}`));
    expect((await res.json()).data.disponivel).toBe(false);
  });
});

describe("GET /api/v1/reports/metas", () => {
  it("monta meta vs realizado por dia e 24 horas de produtos", async () => {
    preparar((nome) =>
      nome === "fn_relatorio_metas"
        ? {
            data: {
              metas_total: 1, alvo_empresa: 30, alvo_por_funis: 0, realizado: 2, receita_cents: 0,
              meses: [{ periodo: "2026-11-01", alvo: 30 }],
              realizado_por_dia: [{ dia: "2026-11-02", total: 2 }],
              por_funil: [], por_vendedor: [],
            },
            error: null,
          }
        : {
            data: {
              produtos_distintos: 0, itens_vendidos: 0, receita_cents: 0, descontos_cents: 0,
              por_dia: [], por_hora: [], top_produtos: [], por_vendedor: [],
            },
            error: null,
          },
    );
    const res = await getMetas(new NextRequest(`http://x/api/v1/reports/metas${JANELA}`));
    const corpo = await res.json();
    expect(corpo.data.metas.meta_vs_realizado).toEqual([
      { dia: "2026-11-01", meta: 1, realizado: 0 },
      { dia: "2026-11-02", meta: 2, realizado: 2 },
    ]);
    expect(corpo.data.produtos.por_hora).toHaveLength(24);
    // Janela de 2 dias num mês de 30 com meta 30: a meta da janela é 2, não 30.
    expect(corpo.data.metas.alvo).toBe(2);
  });
});
