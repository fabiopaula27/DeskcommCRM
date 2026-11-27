"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export type AbaDoRelatorio = "atendimento" | "leads" | "funil" | "metas" | "templates" | "ia";

export type Indisponivel = { disponivel: false; motivo: string };

/** Busca uma aba dos Relatórios. A chave inclui os filtros: trocar o período refaz a busca. */
export function useRelatorio<T>(
  aba: AbaDoRelatorio,
  params: Record<string, string | undefined | null>,
) {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) if (valor) busca.set(chave, valor);
  const qs = busca.toString();
  return useQuery({
    queryKey: ["relatorios", aba, qs],
    queryFn: async () =>
      apiClient.get<{ data: T | Indisponivel }>(`/api/v1/reports/${aba}${qs ? `?${qs}` : ""}`),
    staleTime: 30_000,
  });
}
