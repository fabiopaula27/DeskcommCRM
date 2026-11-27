import { describe, expect, it, vi } from "vitest";

import { rodarEnviosAgendados, type LinhaDoAgendamento } from "./rodada";

const ORG = "22222222-2222-4222-8222-222222222222";
const linha = (over: Partial<LinhaDoAgendamento> = {}): LinhaDoAgendamento => ({
  organization_id: ORG,
  ativo: true,
  frequencia: "diario",
  horario: "08:00:00",
  emails: ["a@x.com"],
  telefones: [],
  channel_session_id: null,
  ultimo_periodo: null,
  tentativas_do_periodo: 0,
  ...over,
});

describe("rodada do envio agendado", () => {
  it("envia o que está na hora e grava o período", async () => {
    const gravar = vi.fn(async () => undefined);
    const enviar = vi.fn(async () => ({ enviado: true, falhas: [] }));
    const r = await rodarEnviosAgendados({
      agendamentos: [linha()],
      paradas: new Set(),
      fusoDe: async () => "America/Sao_Paulo",
      enviar,
      gravar,
      reservar: async () => true,
      agora: new Date("2026-11-27T11:05:00Z"),
    });
    expect(r).toEqual({ enviados: 1, falhas: 0, pulados: 0 });
    expect(gravar).toHaveBeenCalledWith(ORG, expect.objectContaining({ ultimo_periodo: "diario:2026-11-26", tentativas_do_periodo: 0, ultimo_erro: null }));
  });

  it("falha total marca 'falhou' e conta a tentativa", async () => {
    const gravar = vi.fn(async () => undefined);
    await rodarEnviosAgendados({
      agendamentos: [linha({ ultimo_periodo: "falhou:diario:2026-11-26", tentativas_do_periodo: 1 })],
      paradas: new Set(),
      fusoDe: async () => "America/Sao_Paulo",
      enviar: async () => ({ enviado: false, falhas: ["E-mail: not_configured"] }),
      gravar,
      reservar: async () => true,
      agora: new Date("2026-11-27T11:05:00Z"),
    });
    expect(gravar).toHaveBeenCalledWith(ORG, expect.objectContaining({
      ultimo_periodo: "falhou:diario:2026-11-26", tentativas_do_periodo: 2, ultimo_erro: "E-mail: not_configured",
    }));
  });

  it("empresa parada e fora de hora são puladas; erro numa não derruba a outra", async () => {
    const outra = "33333333-3333-4333-8333-333333333333";
    const enviar = vi.fn(async (l: LinhaDoAgendamento) => {
      if (l.organization_id === ORG) throw new Error("boom");
      return { enviado: true, falhas: [] };
    });
    const r = await rodarEnviosAgendados({
      agendamentos: [linha(), linha({ organization_id: outra }), linha({ organization_id: "parada" })],
      paradas: new Set(["parada"]),
      fusoDe: async () => "America/Sao_Paulo",
      enviar,
      gravar: async () => undefined,
      reservar: async () => true,
      agora: new Date("2026-11-27T11:05:00Z"),
    });
    expect(r).toEqual({ enviados: 1, falhas: 1, pulados: 1 });
  });

  it("período já reservado por outra rodada não é enviado de novo", async () => {
    const enviar = vi.fn(async () => ({ enviado: true, falhas: [] }));
    const r = await rodarEnviosAgendados({
      agendamentos: [linha()],
      paradas: new Set(),
      fusoDe: async () => "America/Sao_Paulo",
      enviar,
      gravar: async () => undefined,
      reservar: async () => false,
      agora: new Date("2026-11-27T11:05:00Z"),
    });
    expect(enviar).not.toHaveBeenCalled();
    expect(r.enviados).toBe(0);
  });

  it("para de pegar empresas novas quando o tempo da rodada acaba", async () => {
    let relogio = 0;
    const enviar = vi.fn(async () => {
      relogio += 200_000;
      return { enviado: true, falhas: [] };
    });
    const outra = "33333333-3333-4333-8333-333333333333";
    const r = await rodarEnviosAgendados({
      agendamentos: [linha(), linha({ organization_id: outra })],
      paradas: new Set(),
      fusoDe: async () => "America/Sao_Paulo",
      enviar,
      gravar: async () => undefined,
      reservar: async () => true,
      agora: new Date("2026-11-27T11:05:00Z"),
      prazoMs: 150_000,
      decorrido: () => relogio,
    });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(r.enviados).toBe(1);
  });
});
