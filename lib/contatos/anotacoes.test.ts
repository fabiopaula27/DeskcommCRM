import { describe, expect, it } from "vitest";

import {
  caminhoDoAudio,
  desfechoDaTranscricao,
  paraAnotacao,
  podeMexer,
  recusaDoAudio,
  tabelaAusente,
  textoSchema,
  type LinhaDaAnotacao,
} from "./anotacoes";

const LINHA: LinhaDaAnotacao = {
  id: "n1",
  kind: "text",
  body: "Prefere contato depois das 18h.",
  audio_path: null,
  audio_mime: null,
  audio_duration_s: null,
  source_message_id: null,
  transcription_status: "none",
  created_by: "u1",
  created_at: "2026-11-27T13:00:00.000Z",
  updated_at: "2026-11-27T13:00:00.000Z",
};

describe("anotações — regras", () => {
  it("texto vazio ou só espaços é recusado; acima de 5000 também", () => {
    expect(textoSchema.safeParse({ kind: "text", body: "   " }).success).toBe(false);
    expect(textoSchema.safeParse({ kind: "text", body: "x".repeat(5001) }).success).toBe(false);
    expect(textoSchema.safeParse({ kind: "text", body: " ok " }).data?.body).toBe("ok");
  });

  it("áudio: vazio 400, > 25 MB 413, não-áudio 415, iPhone (audio/mp4) aceito", () => {
    expect(recusaDoAudio(null)?.status).toBe(400);
    expect(recusaDoAudio({ size: 26 * 1024 * 1024, type: "audio/webm" })?.status).toBe(413);
    expect(recusaDoAudio({ size: 10, type: "image/png" })?.status).toBe(415);
    expect(recusaDoAudio({ size: 10, type: "audio/mp4" })).toBeNull();
    expect(recusaDoAudio({ size: 10, type: "audio/webm;codecs=opus" })).toBeNull();
  });

  it("caminho do áudio fica sob org/contato, com extensão do mime", () => {
    expect(caminhoDoAudio("o", "c", "n", "audio/webm;codecs=opus")).toBe("o/c/n.webm");
    expect(caminhoDoAudio("o", "c", "n", "audio/mp4")).toBe("o/c/n.m4a");
    expect(caminhoDoAudio("o", "c", "n", "audio/estranho")).toBe("o/c/n.bin");
  });

  it("desfecho: sem transcritor → unavailable; erro ou vazio → failed; texto → ready", () => {
    expect(desfechoDaTranscricao({ tipo: "sem_transcritor" }).transcription_status).toBe("unavailable");
    expect(desfechoDaTranscricao({ tipo: "erro" }).transcription_status).toBe("failed");
    expect(desfechoDaTranscricao({ tipo: "texto", texto: "  " }).transcription_status).toBe("failed");
    expect(desfechoDaTranscricao({ tipo: "texto", texto: " oi " })).toEqual({ transcription_status: "ready", body: "oi" });
  });

  it("autor mexe na própria; outro agente não; gerente mexe em qualquer uma", () => {
    expect(podeMexer({ created_by: "u1" }, "u1", false)).toBe(true);
    expect(podeMexer({ created_by: "u1" }, "u2", false)).toBe(false);
    expect(podeMexer({ created_by: null }, "u2", false)).toBe(false);
    expect(podeMexer({ created_by: "u1" }, "u2", true)).toBe(true);
  });

  it("paraAnotacao marca editada só quando o texto mudou depois de criado", () => {
    expect(paraAnotacao(LINHA, { audioUrl: null, nomeDoAutor: "Junior", usuarioId: "u1", ehGerente: false })).toMatchObject({
      autor: { id: "u1", nome: "Junior" },
      editadaEm: null,
      podeEditar: true,
      daConversa: false,
    });
    const editada = paraAnotacao({ ...LINHA, updated_at: "2026-11-27T14:00:00.000Z" }, { audioUrl: null, nomeDoAutor: null, usuarioId: "u2", ehGerente: false });
    expect(editada.editadaEm).toBe("2026-11-27T14:00:00.000Z");
    expect(editada.podeEditar).toBe(false);
  });

  it("tabela ausente reconhece 42P01 e PGRST205", () => {
    expect(tabelaAusente({ code: "42P01" })).toBe(true);
    expect(tabelaAusente({ code: "PGRST205" })).toBe(true);
    expect(tabelaAusente({ code: "23505" })).toBe(false);
  });
});

import { audioDoContato } from "./anotacoes";

describe("audioDoContato", () => {
  it("só aceita caminho dentro da pasta do próprio contato", () => {
    expect(audioDoContato("o/c/n.webm", "o", "c")).toBe(true);
    expect(audioDoContato("outra/c/n.webm", "o", "c")).toBe(false);
    expect(audioDoContato("o/outro/n.webm", "o", "c")).toBe(false);
    expect(audioDoContato("o/c/../x/n.webm", "o", "c")).toBe(false);
    expect(audioDoContato(null, "o", "c")).toBe(false);
  });
});
