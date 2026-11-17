import { describe, expect, it } from "vitest";

import { CHANNEL_SESSION_REF_COLUMNS, resolveSessionRef } from "./session-ref";

describe("resolveSessionRef", () => {
  it("evolution: o ref é o nome da instância", () => {
    expect(resolveSessionRef({ provider: "evolution", evolution_instance_name: "dc-abc" })).toBe("dc-abc");
  });

  it("o select traz a coluna da instância", () => {
    expect(CHANNEL_SESSION_REF_COLUMNS).toContain("evolution_instance_name");
  });
});
