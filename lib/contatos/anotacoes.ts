/**
 * Anotações do lead (migration 9115): o que o vendedor sabe do contato, por
 * texto ou áudio transcrito. Regras puras aqui; as rotas em
 * `app/api/v1/contacts/[id]/notes/**` só fazem I/O.
 */
import { z } from "zod";

export const BUCKET_DAS_ANOTACOES = "contact-notes";
export const LIMITE_DO_AUDIO_BYTES = 25 * 1024 * 1024;
export const LIMITE_DO_TEXTO = 5000;

export type StatusDaTranscricao = "none" | "pending" | "ready" | "failed" | "unavailable";

export type LinhaDaAnotacao = {
  id: string;
  kind: "text" | "audio";
  body: string | null;
  audio_path: string | null;
  audio_mime: string | null;
  audio_duration_s: number | null;
  source_message_id: string | null;
  transcription_status: StatusDaTranscricao;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Anotacao = {
  id: string;
  kind: "text" | "audio";
  body: string | null;
  audioUrl: string | null;
  duracao: number | null;
  status: StatusDaTranscricao;
  daConversa: boolean;
  autor: { id: string; nome: string | null } | null;
  criadaEm: string;
  editadaEm: string | null;
  podeEditar: boolean;
};

export const COLUNAS_DA_ANOTACAO =
  "id, kind, body, audio_path, audio_mime, audio_duration_s, source_message_id, transcription_status, created_by, created_at, updated_at";

export const textoSchema = z.object({
  kind: z.literal("text"),
  body: z.string().trim().min(1, "Escreva a anotação.").max(LIMITE_DO_TEXTO, "Anotação longa demais (máx. 5000 caracteres)."),
});

export const audioDaConversaSchema = z.object({
  kind: z.literal("audio"),
  messageId: z.string().uuid(),
});

export const edicaoSchema = z.object({
  body: z.string().trim().min(1, "Escreva a anotação.").max(LIMITE_DO_TEXTO, "Anotação longa demais (máx. 5000 caracteres)."),
});

/** Autor edita/apaga a própria; manager+ apaga e edita qualquer uma. */
export function podeMexer(linha: { created_by: string | null }, usuarioId: string, ehGerente: boolean): boolean {
  return ehGerente || (linha.created_by !== null && linha.created_by === usuarioId);
}

export type RecusaDoAudio = { status: 413 | 415 | 400; mensagem: string } | null;

export function recusaDoAudio(arquivo: { size: number; type: string } | null): RecusaDoAudio {
  if (!arquivo || arquivo.size === 0) return { status: 400, mensagem: "Envie um áudio." };
  if (arquivo.size > LIMITE_DO_AUDIO_BYTES) return { status: 413, mensagem: "Áudio grande demais (máx. 25 MB)." };
  if (!mimeBase(arquivo.type).startsWith("audio/")) return { status: 415, mensagem: "O arquivo enviado não é um áudio." };
  return null;
}

export function mimeBase(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

const EXTENSOES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function caminhoDoAudio(orgId: string, contatoId: string, id: string, mime: string): string {
  return `${orgId}/${contatoId}/${id}.${EXTENSOES[mimeBase(mime)] ?? "bin"}`;
}

/** Resultado da transcrição → status e corpo gravados. Vazio conta como falha. */
export function desfechoDaTranscricao(
  r: { tipo: "sem_transcritor" } | { tipo: "erro" } | { tipo: "texto"; texto: string },
): { transcription_status: StatusDaTranscricao; body: string | null } {
  if (r.tipo === "sem_transcritor") return { transcription_status: "unavailable", body: null };
  if (r.tipo === "erro") return { transcription_status: "failed", body: null };
  const texto = r.texto.trim();
  return texto ? { transcription_status: "ready", body: texto.slice(0, 20000) } : { transcription_status: "failed", body: null };
}

export function paraAnotacao(
  l: LinhaDaAnotacao,
  extra: { audioUrl: string | null; nomeDoAutor: string | null; usuarioId: string; ehGerente: boolean },
): Anotacao {
  const editada = l.kind === "text" && Date.parse(l.updated_at) - Date.parse(l.created_at) > 1000;
  return {
    id: l.id,
    kind: l.kind,
    body: l.body,
    audioUrl: extra.audioUrl,
    duracao: l.audio_duration_s,
    status: l.transcription_status,
    daConversa: l.source_message_id !== null,
    autor: l.created_by ? { id: l.created_by, nome: extra.nomeDoAutor } : null,
    criadaEm: l.created_at,
    editadaEm: editada ? l.updated_at : null,
    podeEditar: podeMexer(l, extra.usuarioId, extra.ehGerente),
  };
}

/** A tabela não existe (migration 9115 não rodou). */
export function tabelaAusente(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}
