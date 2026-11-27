import { describe, expect, it } from "vitest";

import type { Anotacao } from "@/lib/contatos/anotacoes";
import type { Tarefa } from "@/lib/tarefas/tipos";

import { campoDoResumo, linhaDoTempo, mimeDeGravacao } from "./linha-do-tempo-das-anotacoes";

const nota = (id: string, criadaEm: string) => ({ id, criadaEm }) as Anotacao;
const tarefa = (id: string, created_at: string) => ({ id, created_at }) as Tarefa;

describe("linha do tempo das anotações", () => {
  it("mistura anotações e tarefas, mais recentes primeiro", () => {
    const r = linhaDoTempo(
      [nota("a1", "2026-11-26T19:20:00Z"), nota("a2", "2026-11-27T17:32:00Z")],
      [tarefa("t1", "2026-11-27T13:05:00Z")],
    );
    expect(r.map((i) => (i.tipo === "anotacao" ? i.anotacao.id : i.tarefa.id))).toEqual(["a2", "t1", "a1"]);
  });

  it("vazia quando não há nada", () => {
    expect(linhaDoTempo([], [])).toEqual([]);
  });

  it("gravação: webm quando dá; no Safari/iPhone cai para mp4; sem suporte nenhum, null", () => {
    expect(mimeDeGravacao((m) => m.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(mimeDeGravacao((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(mimeDeGravacao(() => false)).toBeNull();
  });

  it("acha o campo personalizado rotulado Resumo, sem ligar para maiúsculas", () => {
    expect(campoDoResumo([{ key: "cep", label: "CEP" }, { key: "resumo_ia", label: " RESUMO " }])).toBe("resumo_ia");
    expect(campoDoResumo([{ key: "cep", label: "CEP" }])).toBeNull();
  });
});
