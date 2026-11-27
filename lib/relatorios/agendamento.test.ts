import { describe, expect, it } from "vitest";

import { envioDevido, periodoDoEnvio } from "./agendamento";

const TZ = "America/Sao_Paulo";

describe("período do envio agendado", () => {
  it("diário cobre ontem", () => {
    const p = periodoDoEnvio("diario", new Date("2026-11-27T11:00:00Z"), TZ);
    expect(p).toMatchObject({ chave: "diario:2026-11-26", de: "2026-11-26", ate: "2026-11-26" });
    expect(p.from).toBe("2026-11-26T03:00:00.000Z");
    expect(p.to).toBe("2026-11-27T03:00:00.000Z");
  });

  it("semanal cobre a semana anterior, de segunda a domingo", () => {
    // 2026-11-27 é sexta-feira.
    const p = periodoDoEnvio("semanal", new Date("2026-11-27T11:00:00Z"), TZ);
    expect(p).toMatchObject({ de: "2026-11-16", ate: "2026-11-22", chave: "semanal:2026-11-16" });
  });

  it("mensal cobre o mês anterior inteiro", () => {
    const p = periodoDoEnvio("mensal", new Date("2026-11-27T11:00:00Z"), TZ);
    expect(p).toMatchObject({ de: "2026-10-01", ate: "2026-10-31", chave: "mensal:2026-10" });
  });
});

describe("envio devido", () => {
  const base = { ativo: true, frequencia: "diario" as const, horario: "08:00", ultimo_periodo: null, tentativas_do_periodo: 0 };

  it("antes do horário local não envia", () => {
    expect(envioDevido(base, new Date("2026-11-27T10:59:00Z"), TZ)).toBeNull(); // 07:59 local
  });

  it("no horário envia o período de ontem", () => {
    expect(envioDevido(base, new Date("2026-11-27T11:05:00Z"), TZ)?.chave).toBe("diario:2026-11-26");
  });

  it("período já enviado não repete", () => {
    expect(envioDevido({ ...base, ultimo_periodo: "diario:2026-11-26" }, new Date("2026-11-27T15:00:00Z"), TZ)).toBeNull();
  });

  it("desligado não envia", () => {
    expect(envioDevido({ ...base, ativo: false }, new Date("2026-11-27T15:00:00Z"), TZ)).toBeNull();
  });

  it("depois de 2 falhas no mesmo período desiste", () => {
    expect(
      envioDevido({ ...base, ultimo_periodo: "falhou:diario:2026-11-26", tentativas_do_periodo: 2 }, new Date("2026-11-27T15:00:00Z"), TZ),
    ).toBeNull();
  });

  it("semanal só sai na segunda-feira", () => {
    const semanal = { ...base, frequencia: "semanal" as const };
    expect(envioDevido(semanal, new Date("2026-11-27T15:00:00Z"), TZ)).toBeNull(); // sexta
    expect(envioDevido(semanal, new Date("2026-11-30T15:00:00Z"), TZ)?.chave).toBe("semanal:2026-11-23");
  });

  it("mensal só sai no dia 1", () => {
    const mensal = { ...base, frequencia: "mensal" as const };
    expect(envioDevido(mensal, new Date("2026-11-27T15:00:00Z"), TZ)).toBeNull();
    expect(envioDevido(mensal, new Date("2026-12-01T15:00:00Z"), TZ)?.chave).toBe("mensal:2026-11");
  });
});
