"use client";

/**
 * Faixa vermelha no topo quando a agenda do Google de quem está usando o
 * sistema perdeu a conexão. Mesmo desenho da faixa de WhatsApp desconectado
 * (`ConexaoCaidaBanner`): é o mesmo tipo de urgência.
 */
import Link from "next/link";

import { useT } from "@/hooks/i18n/useT";
import type { AgendaCaida } from "@/lib/agenda/google/conexao-caida";

export function AgendaGoogleCaidaBanner({ caida }: { caida: AgendaCaida | null }) {
  const t = useT();
  if (!caida) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-red-300 bg-red-100/95 px-4 py-2 text-sm text-red-950 backdrop-blur dark:border-red-800/60 dark:bg-red-950/70 dark:text-red-50"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden>📅</span>
        <span>
          {t("Sua agenda do Google")}
          {caida.email ? (
            <>
              {" "}
              (<strong className="font-semibold">{caida.email}</strong>)
            </>
          ) : null}{" "}
          {t("está desconectada — os compromissos do Google não chegam ao CRM nem ao resumo diário.")}
        </span>
      </div>
      <Link
        href="/app/settings/tenant/agenda"
        className="rounded-md border border-red-400 bg-white/70 px-3 py-1 font-medium text-red-950 hover:bg-white max-md:inline-flex max-md:min-h-11 max-md:items-center dark:border-red-700 dark:bg-red-900/40 dark:text-red-50 dark:hover:bg-red-900/70"
      >
        {t("Reconectar agenda")}
      </Link>
    </div>
  );
}
