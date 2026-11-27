/**
 * A volta do login da Meta para Conexões › Redes sociais, por PÁGINA-PONTE e
 * não por redirect: o cookie de sessão é `SameSite=Strict`, e uma navegação
 * que começou em facebook.com não o levaria (mesmo motivo do callback da Agenda
 * do Google). A ponte é um documento nosso; a navegação seguinte é same-site.
 */
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

import { CAMINHO_DO_RETORNO_META } from "./conexao";

export const COOKIE_DO_VINCULO_META = "crm_meta_bind";

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function voltarParaConexoes(parametros: Record<string, string>): NextResponse {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const destino = new URL("/app/connections", base);
  destino.searchParams.set("aba", "sociais");
  for (const [k, v] of Object.entries(parametros)) destino.searchParams.set(k, v);
  const alvo = destino.toString();
  const seguro = escaparHtml(alvo);
  const resposta = new NextResponse(
    `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
      `<noscript><meta http-equiv="refresh" content="0;url=${seguro}"></noscript><title>Voltando…</title></head><body>` +
      `<p>Voltando para Conexões…</p><script>location.replace(${JSON.stringify(alvo)})</script>` +
      `<noscript><p><a href="${seguro}">Continuar</a></p></noscript></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
  resposta.cookies.set(COOKIE_DO_VINCULO_META, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_RETORNO_META,
    maxAge: 0,
  });
  return resposta;
}

export function enderecoDeRetorno(): string {
  const base = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(CAMINHO_DO_RETORNO_META, base).toString();
}
