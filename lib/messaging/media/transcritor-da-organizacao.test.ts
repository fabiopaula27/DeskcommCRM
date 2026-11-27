import { describe, expect, it, vi } from "vitest";

import { transcritorDaOrganizacao, type DepsDoTranscritor } from "./transcritor-da-organizacao";

const transcriber = { transcribe: vi.fn() } as never;

function deps(over: Partial<DepsDoTranscritor> = {}): DepsDoTranscritor {
  return {
    resolver: vi.fn(async () => ({ provider: "anthropic", apiKey: "k", defaultModel: "m" })) as never,
    decidir: vi.fn(async () => ({ transcriber, motivo: "ok", origem: "x" })) as never,
    lerBinding: vi.fn(async () => null),
    pool: () => ({}) as never,
    ...over,
  };
}

describe("transcritorDaOrganizacao", () => {
  it("devolve o transcritor que a escada escolheu", async () => {
    expect((await transcritorDaOrganizacao("org", deps())).transcriber).toBe(transcriber);
  });

  it("sem transcritor: null com o motivo", async () => {
    const r = await transcritorDaOrganizacao(
      "org",
      deps({ decidir: vi.fn(async () => ({ transcriber: null, motivo: "sem chave" })) as never }),
    );
    expect(r).toEqual({ transcriber: null, motivo: "sem chave" });
  });

  it("org sem credencial padrão não derruba: a escada recebe conversa nula", async () => {
    const decidir = vi.fn(async () => ({ transcriber: null, motivo: "nada" }));
    await transcritorDaOrganizacao("org", deps({ resolver: vi.fn(async () => { throw new Error("x"); }) as never, decidir: decidir as never }));
    expect((decidir.mock.calls[0] as unknown as [{ conversa: unknown }])[0].conversa).toBeNull();
  });

  it("Scribe escolhido no painel vira o degrau 0", async () => {
    const decidir = vi.fn(async (e: { elevenlabsEscolhido: () => Promise<unknown> }) => ({
      transcriber: null,
      motivo: JSON.stringify(await e.elevenlabsEscolhido()),
    }));
    const r = await transcritorDaOrganizacao(
      "org",
      deps({
        decidir: decidir as never,
        lerBinding: vi.fn(async () => ({ provider: "elevenlabs", model_id: "", credential_id: "c" })),
      }),
    );
    expect(JSON.parse(r.motivo)).toEqual({ apiKey: "k", modelId: "scribe_v1" });
  });

  it("escada que lança vira motivo, não exceção", async () => {
    const r = await transcritorDaOrganizacao("org", deps({ decidir: vi.fn(async () => { throw new Error("boom"); }) as never }));
    expect(r).toEqual({ transcriber: null, motivo: "boom" });
  });
});
