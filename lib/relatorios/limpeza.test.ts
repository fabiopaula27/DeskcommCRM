import { describe, expect, it, vi } from "vitest";

import { limparPdfsAntigos } from "./limpeza";

const agora = new Date("2026-11-27T12:00:00Z");

function storage(arvore: Record<string, { name: string; id: string | null; created_at?: string }[]>) {
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const bucket = {
    list: vi.fn(async (pasta: string) => ({ data: arvore[pasta] ?? [], error: null })),
    remove,
  };
  return { bucket, remove };
}

describe("limpeza dos PDFs do envio agendado", () => {
  it("apaga só os arquivos com mais de 7 dias, em todas as pastas", async () => {
    const { bucket, remove } = storage({
      "": [{ name: "org-a", id: null }, { name: "org-b", id: null }],
      "org-a": [
        { name: "velho.pdf", id: "1", created_at: "2026-11-10T00:00:00Z" },
        { name: "novo.pdf", id: "2", created_at: "2026-11-26T00:00:00Z" },
      ],
      "org-b": [{ name: "velho2.pdf", id: "3", created_at: "2026-11-01T00:00:00Z" }],
    });
    const n = await limparPdfsAntigos(bucket as never, agora);
    expect(n).toBe(2);
    expect(remove).toHaveBeenCalledWith(["org-a/velho.pdf"]);
    expect(remove).toHaveBeenCalledWith(["org-b/velho2.pdf"]);
  });

  it("nada velho, nada apagado", async () => {
    const { bucket, remove } = storage({ "": [{ name: "org-a", id: null }], "org-a": [{ name: "n.pdf", id: "1", created_at: "2026-11-27T00:00:00Z" }] });
    expect(await limparPdfsAntigos(bucket as never, agora)).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });
});
