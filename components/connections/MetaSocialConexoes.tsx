"use client";

/**
 * Messenger e Instagram Direct pela conexão DIRETA com a Meta: o botão
 * "Conectar com Facebook", os canais conectados e o resultado da volta do login
 * (que chega na URL: `?meta=ok|erro&conectadas=…&motivo=…`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Canal = { id: string; plataforma: "facebook" | "instagram"; nome: string; status: string; conectadoEm: string };
type Estado = { canais: Canal[]; pronto: boolean; falta: string[]; podeConectar: boolean };

const MOTIVOS: Record<string, string> = {
  cancelado: "Você cancelou na janela da Meta. Nada foi conectado.",
  retorno_nao_verificavel: "Não deu para confirmar a volta do Facebook. Tente de novo pelo botão.",
  sem_permissao: "Só o dono ou um administrador da empresa pode conectar páginas.",
  app_nao_configurado: "O app da Meta desta instalação ainda não está configurado.",
  nenhuma_pagina: "Nenhuma página foi autorizada. Na janela da Meta, marque ao menos uma página.",
  em_outra_empresa: "Essas páginas já estão conectadas em outra empresa deste CRM.",
  meta_recusou: "A Meta recusou a conexão. Confira as permissões do app e tente de novo.",
  falha: "Não consegui conectar as páginas autorizadas. Tente de novo.",
  segredo_indisponivel: "O servidor não conseguiu iniciar a conexão com segurança. Fale com o suporte.",
};

export function MetaSocialConexoes() {
  const t = useT();
  const qc = useQueryClient();
  const params = useSearchParams();
  const estado = useQuery({
    queryKey: ["meta-social"],
    queryFn: async () => (await apiClient.get<{ data: Estado }>("/api/v1/channels/meta-social")).data,
  });
  const desconectar = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/api/v1/channels/meta-social/${id}`),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meta-social"] }),
  });

  const volta = params.get("meta");
  const motivo = params.get("motivo");
  const emOutra = params.get("em_outra_empresa");

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t("Messenger e Instagram Direct")}</h3>
          <p className="text-sm text-text-muted">
            {t("As mensagens da sua página do Facebook e do Instagram profissional chegam no Inbox, e você responde por lá.")}
          </p>
        </div>
        {estado.data?.podeConectar && estado.data.pronto && (
          <Button asChild>
            <a href="/api/v1/channels/meta-social/login">{t("Conectar com Facebook")}</a>
          </Button>
        )}
      </div>

      {volta === "ok" && (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          {t("Conectado")}: {params.get("conectadas")} {t("canal(is)")}.
          {emOutra ? ` ${t("Já estavam em outra empresa")}: ${emOutra}.` : ""}
        </p>
      )}
      {volta === "erro" && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
          {t(MOTIVOS[motivo ?? ""] ?? MOTIVOS.falha!)}
          {emOutra ? ` (${emOutra})` : ""}
        </p>
      )}

      {estado.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : estado.data && !estado.data.pronto ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="falta-config">
          {t("Falta configurar o app da Meta no servidor")}: {estado.data.falta.join(", ")}.
        </p>
      ) : null}

      {estado.data && estado.data.canais.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {estado.data.canais.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <Badge variant="outline">{c.plataforma === "instagram" ? "Instagram" : "Messenger"}</Badge>
              <span className="font-medium">{c.nome}</span>
              <span className={c.status === "WORKING" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
                {c.status === "WORKING" ? t("recebendo") : t("desconectado — reconecte pelo botão")}
              </span>
              {estado.data?.podeConectar && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={desconectar.isPending}
                  onClick={() => window.confirm(t("Desconectar este canal? As conversas continuam no histórico.")) && desconectar.mutate(c.id)}
                >
                  {t("Desconectar")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : estado.data?.pronto ? (
        <p className="text-sm text-text-muted">{t("Nenhuma página conectada ainda.")}</p>
      ) : null}
    </Card>
  );
}
