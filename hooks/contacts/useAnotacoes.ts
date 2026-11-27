"use client";
/**
 * Anotações do lead (aba "Anotações" da ficha do contato) e o Resumo da IA.
 * O áudio sobe por `fetch` com FormData: o `apiClient` só manda JSON.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { Anotacao } from "@/lib/contatos/anotacoes";

export type AudioDaConversa = { id: string; enviadoEm: string; trecho: string | null; temArquivo: boolean };
export type ResumoDoLead = { texto: string; geradoEm: string; semDados: boolean };

const LONGO = { timeoutMs: 120_000 };
const chave = (contactId: string) => ["anotacoes", contactId] as const;

export function useAnotacoes(contactId: string) {
  const qc = useQueryClient();
  const lista = useQuery({
    queryKey: chave(contactId),
    queryFn: async () => {
      const r = await apiClient.get<{ data: { disponivel: boolean; motivo?: string; anotacoes: Anotacao[] } }>(
        `/api/v1/contacts/${contactId}/notes`,
      );
      return r.data;
    },
  });
  const recarregar = () => qc.invalidateQueries({ queryKey: chave(contactId) });

  const criarTexto = useMutation({
    mutationFn: (body: string) => apiClient.post(`/api/v1/contacts/${contactId}/notes`, { kind: "text", body }),
    onError: showApiError,
    onSuccess: recarregar,
  });

  const enviarAudio = useMutation({
    mutationFn: async ({ arquivo, duracao }: { arquivo: Blob; duracao: number | null }) => {
      const form = new FormData();
      const nome = arquivo instanceof File ? arquivo.name : "gravacao";
      form.append("audio", arquivo, nome);
      if (duracao) form.append("duracao", String(duracao));
      const res = await fetch(`/api/v1/contacts/${contactId}/notes`, { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) throw new Error(json?.error?.message ?? "Não consegui salvar o áudio.");
      return json;
    },
    onError: showApiError,
    onSuccess: recarregar,
  });

  const usarAudioDaConversa = useMutation({
    mutationFn: (messageId: string) =>
      apiClient.post(`/api/v1/contacts/${contactId}/notes`, { kind: "audio", messageId }, LONGO),
    onError: showApiError,
    onSuccess: recarregar,
  });

  const editar = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiClient.patch(`/api/v1/contacts/${contactId}/notes/${id}`, { body }),
    onError: showApiError,
    onSuccess: recarregar,
  });

  const apagar = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/contacts/${contactId}/notes/${id}`),
    onError: showApiError,
    onSuccess: recarregar,
  });

  const transcreverDeNovo = useMutation({
    mutationFn: (id: string) => apiClient.post(`/api/v1/contacts/${contactId}/notes/${id}/transcrever`, {}, LONGO),
    onError: showApiError,
    onSuccess: recarregar,
  });

  return { lista, criarTexto, enviarAudio, usarAudioDaConversa, editar, apagar, transcreverDeNovo };
}

export function useAudiosDaConversa(contactId: string, aberto: boolean) {
  return useQuery({
    queryKey: ["anotacoes-audios", contactId],
    enabled: aberto,
    queryFn: async () =>
      (await apiClient.get<{ data: { audios: AudioDaConversa[] } }>(`/api/v1/contacts/${contactId}/notes/audios-da-conversa`)).data
        .audios,
  });
}

export function useResumoDoLead(contactId: string) {
  return useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ data: ResumoDoLead }>(`/api/v1/contacts/${contactId}/ai-summary`, {}, { timeoutMs: 90_000 })).data,
    onError: showApiError,
  });
}
