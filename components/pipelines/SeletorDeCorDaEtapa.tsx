"use client";

import { useEffect, useRef, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { CORES_DAS_ETAPAS } from "@/lib/leads/cores-das-etapas";

/**
 * A bolinha de cor da etapa. Clicar abre as 12 cores prontas e "Sem cor".
 * Sem dependência de popover: um painel posicionado que fecha com Esc ou
 * clique fora.
 */
export function SeletorDeCorDaEtapa({
  cor,
  aoEscolher,
  desabilitado = false,
  rotulo,
}: {
  cor: string | null | undefined;
  aoEscolher: (cor: string | null) => void;
  desabilitado?: boolean;
  /** Nome da etapa, para o leitor de tela. */
  rotulo: string;
}) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const escolher = (c: string | null) => {
    setAberto(false);
    if (c !== (cor ?? null)) aoEscolher(c);
  };

  return (
    <div ref={raiz} className="relative shrink-0">
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-label={`${t("Cor da etapa")} ${rotulo}`}
        title={t("Cor da etapa")}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-elevated disabled:opacity-50"
      >
        <span
          className="h-5 w-5 rounded-full border border-border-strong"
          style={cor ? { backgroundColor: cor, borderColor: cor } : undefined}
        />
      </button>
      {aberto ? (
        <div
          role="group"
          aria-label={t("Escolha a cor da etapa")}
          className="absolute left-0 top-11 z-30 w-48 rounded-md border border-border bg-surface p-2 shadow-lg"
        >
          <div className="grid grid-cols-6 gap-1.5">
            {CORES_DAS_ETAPAS.map((c) => (
              <button
                key={c.cor}
                type="button"
                onClick={() => escolher(c.cor)}
                aria-label={t(c.nome)}
                aria-pressed={cor?.toLowerCase() === c.cor}
                title={t(c.nome)}
                className="h-6 w-6 rounded-full ring-offset-2 ring-offset-surface hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-text"
                style={{ backgroundColor: c.cor }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => escolher(null)}
            className="mt-2 w-full rounded-md px-2 py-1 text-left text-xs text-text-muted hover:bg-surface-elevated"
          >
            {t("Sem cor")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
