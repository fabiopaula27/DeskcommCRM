import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ isServiceRoleConfigured: () => false }));

import { GET } from "./route";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const URL_BASE = "http://localhost/api/v1/reports/atendimento";

function autorizar() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: "u1", idioma: "pt-BR" },
    org: { orgId: ORG_ID, name: "Org", role: "manager" },
  } as never);
}

function cliente(rpc: { data: unknown; error: unknown }) {
  const org = { data: { timezone: "America/Sao_Paulo" }, error: null };
  const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => org };
  vi.mocked(createClient).mockResolvedValue({
    from: () => builder,
    rpc: vi.fn(async () => rpc),
  } as never);
}

const PAYLOAD = {
  hoje: { conversas: 7, leads: 3, vendas: 0, receita_cents: 0 },
  ontem: { conversas: 18, leads: 9, vendas: 0, receita_cents: 0 },
  trinta_dias: { conversas: 158, leads: 119, vendas: 0, receita_cents: 0 },
  conversas_por_dia: [{ dia: "2026-11-02", total: 4 }],
  conversas_resumo: { total: 4, ativas: 1, pausadas: 3, tempo_medio_atendimento_s: null, tempo_primeira_resposta_s: 180 },
  por_canal: [], mensagens: { enviadas: 0, humanas: 0, ia: 0, recebidas: 0, conversas_com_mensagem: 0 },
  humanas_por_hora: [], ia_por_hora: [], ia_por_dia: [], atendentes: [], distribuicoes: [],
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/v1/reports/atendimento", () => {
  it("403 quando o papel não alcança manager", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden_role", "x", 403) } as never);
    const res = await GET(new NextRequest(URL_BASE));
    expect(res.status).toBe(403);
  });

  it("422 quando from é depois de to", async () => {
    autorizar();
    cliente({ data: PAYLOAD, error: null });
    const res = await GET(new NextRequest(`${URL_BASE}?from=2026-11-10T00:00:00Z&to=2026-11-01T00:00:00Z`));
    expect(res.status).toBe(422);
  });

  it("avisa quando a migration não foi aplicada", async () => {
    autorizar();
    cliente({ data: null, error: { code: "PGRST202", message: "not found" } });
    const res = await GET(new NextRequest(URL_BASE));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.data.disponivel).toBe(false);
  });

  it("preenche um item por dia do período e calcula a variação", async () => {
    autorizar();
    cliente({ data: PAYLOAD, error: null });
    const res = await GET(new NextRequest(`${URL_BASE}?from=2026-11-01T03:00:00.000Z&to=2026-11-04T03:00:00.000Z`));
    const corpo = await res.json();
    expect(corpo.data.disponivel).toBe(true);
    expect(corpo.data.conversas_por_dia.map((d: { total: number }) => d.total)).toEqual([0, 4, 0]);
    expect(corpo.data.cartoes.conversas.variacao).toEqual({ tipo: "pct", pct: -61.1 });
    expect(corpo.data.humanas_por_hora).toHaveLength(24);
  });

  it("com fila escolhida, a distribuição vem da função por fila", async () => {
    autorizar();
    const rpc = vi.fn(async (nome: string) =>
      nome === "fn_relatorio_distribuicoes"
        ? { data: [{ user_id: "u9", total: 31 }], error: null }
        : { data: PAYLOAD, error: null },
    );
    const org = { data: { timezone: "America/Sao_Paulo" }, error: null };
    const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => org };
    vi.mocked(createClient).mockResolvedValue({ from: () => builder, rpc } as never);
    const setor = "44444444-4444-4444-8444-444444444444";
    const res = await GET(new NextRequest(`${URL_BASE}?setor_id=${setor}&user_id=${setor}`));
    const corpo = await res.json();
    expect(rpc).toHaveBeenCalledWith("fn_relatorio_distribuicoes", expect.objectContaining({ p_setor: setor, p_user: setor }));
    expect(corpo.data.distribuicoes[0].total).toBe(31);
  });
});
