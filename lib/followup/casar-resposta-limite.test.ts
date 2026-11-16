import { describe, expect, it } from "vitest";

import { MAX_REGRAS_CASAR_RESPOSTA, matchReplyConfigSchema } from "@/lib/followup/graph-schema";

const regras = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `br_${i}`,
    label: `Regra ${i}`,
    op: "eq" as const,
    pattern: String(i),
  }));

describe("Casar resposta: limite de regras", () => {
  it("aceita um menu de 9 opções com número e texto (18 regras) e o teto inteiro", () => {
    expect(matchReplyConfigSchema.safeParse({ branches: regras(18), grace_timeout_ms: 900_000 }).success).toBe(true);
    expect(
      matchReplyConfigSchema.safeParse({ branches: regras(MAX_REGRAS_CASAR_RESPOSTA), grace_timeout_ms: 900_000 })
        .success,
    ).toBe(true);
  });

  it("recusa acima do teto", () => {
    expect(
      matchReplyConfigSchema.safeParse({
        branches: regras(MAX_REGRAS_CASAR_RESPOSTA + 1),
        grace_timeout_ms: 900_000,
      }).success,
    ).toBe(false);
  });
});
