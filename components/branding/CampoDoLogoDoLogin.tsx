"use client";

/**
 * O logo exclusivo da página de login — subir, ver e remover. Só na instalação.
 * Mesma rota do logo (`peca=login`, coluna `login_logo_path`, migration 9110).
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TAMANHO_MAXIMO_DO_LOGO } from "@/lib/branding/logo";
import { useT } from "@/hooks/i18n/useT";

interface Props {
  /** O ícone gravado nesta instalação, já como URL pública. `url: null` = nenhum. */
  readonly iconeDaCamada: { readonly url: string | null };
}

const ERRO_EM_PORTUGUES: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo para trocar o ícone da aba.",
  forbidden_role: "Você não tem permissão para trocar o ícone da aba.",
  mfa_required: "Confirme o segundo fator nesta sessão e tente de novo.",
  rate_limited: "Muitas trocas seguidas. Tente de novo em alguns minutos.",
};

export function CampoDoLogoDoLogin({ iconeDaCamada }: Props) {
  const t = useT();
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [, startTransition] = useTransition();

  const [iconeGravado, setIconeGravado] = useState<string | null>(iconeDaCamada.url);
  const [ultimoDoServidor, setUltimoDoServidor] = useState(iconeDaCamada);
  if (iconeDaCamada !== ultimoDoServidor) {
    setUltimoDoServidor(iconeDaCamada);
    setIconeGravado(iconeDaCamada.url);
  }

  async function urlDaResposta(resposta: Response): Promise<string | null | undefined> {
    const corpo = (await resposta.json().catch(() => null)) as {
      data?: { logo_url?: string | null };
    } | null;
    return corpo?.data?.logo_url;
  }

  async function razaoDaFalha(resposta: Response): Promise<string> {
    const corpo = (await resposta.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const codigo = corpo?.error?.code ?? "";
    return t(
      ERRO_EM_PORTUGUES[codigo] ??
        corpo?.error?.message ??
        "Não consegui trocar o logo do login agora.",
    );
  }

  async function enviar(arquivo: File) {
    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.set("escopo", "instalacao");
      corpo.set("peca", "login");
      corpo.set("file", arquivo);
      const resposta = await fetch("/api/v1/marca/logo", { method: "POST", body: corpo });
      if (!resposta.ok) {
        toast.error(await razaoDaFalha(resposta));
        return;
      }
      toast.success(t("Logo do login atualizado."));
      const gravado = await urlDaResposta(resposta);
      if (gravado !== undefined) setIconeGravado(gravado);
      startTransition(() => router.refresh());
    } finally {
      setEnviando(false);
      // Sem isto, escolher o MESMO arquivo de novo não dispara `change`.
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function remover() {
    setEnviando(true);
    try {
      const resposta = await fetch("/api/v1/marca/logo?escopo=instalacao&peca=login", {
        method: "DELETE",
      });
      if (!resposta.ok) {
        toast.error(await razaoDaFalha(resposta));
        return;
      }
      toast.success(t("Logo do login removido."));
      const gravado = await urlDaResposta(resposta);
      if (gravado !== undefined) setIconeGravado(gravado);
      startTransition(() => router.refresh());
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-2" data-campo-do-logo-do-login="">
      <Label htmlFor="logo-do-login">{t("Logo da página de login")}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <div
          data-previa-do-icone={iconeGravado ? "arquivo" : "desenhado"}
          className="flex h-14 min-w-24 shrink-0 items-center justify-center rounded-sm border border-border bg-surface px-2"
        >
          {/* <img> e não next/image: a URL é do storage de quem hospeda, e o
            `next/image` exige allowlist de domínios fechada em BUILD. Sem
            arquivo, a prévia é o próprio ícone desenhado que a aba usa. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {iconeGravado ? (
            <img src={iconeGravado} alt={t("Logo do login")} className="max-h-12 w-auto object-contain" />
          ) : (
            <span className="text-xs text-text-muted">{t("Usa o logo da marca")}</span>
          )}
        </div>
        <input
          ref={entrada}
          id="logo-do-login"
          type="file"
          // Filtra o seletor; quem decide o tipo é o farejador de bytes da rota.
          accept="image/png,image/jpeg"
          disabled={enviando}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void enviar(arquivo);
          }}
          className="max-w-xs text-sm file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-border file:bg-surface-elevated file:px-3 file:py-1.5 file:text-sm"
        />
        {iconeGravado ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void remover()}
            disabled={enviando}
          >
            {t("Remover logo do login")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-text-muted">
        {t("Aparece só na tela de login. PNG ou JPG, até")}{" "}
        {Math.round(TAMANHO_MAXIMO_DO_LOGO / 1024)}{" "}
        {t("KB. Sem arquivo, o login usa o logo da marca.")}
      </p>
    </div>
  );
}
