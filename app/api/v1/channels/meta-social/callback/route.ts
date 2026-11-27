/**
 * GET /api/v1/channels/meta-social/callback — a volta da janela da Meta.
 * Ordem: `state` assinado → cookie de vínculo → a pessoa ainda é admin da
 * empresa → troca do código → páginas e Instagrams autorizados → canais.
 * Toda saída é a página-ponte para Conexões, com o resultado na URL.
 */
import type { NextRequest } from "next/server";

import { verificarEstado } from "@/lib/agenda/google/estado";
import { vinculoConfere } from "@/lib/agenda/google/vinculo";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/auth/types";
import { appDaMeta } from "@/lib/channels/meta/app";
import { conectarContas, configDoLoginMeta, listarContas, trocarCodigo } from "@/lib/channels/meta-social/conexao";
import { COOKIE_DO_VINCULO_META, enderecoDeRetorno, voltarParaConexoes } from "@/lib/channels/meta-social/volta";
import { env } from "@/lib/env";
import { supportCallbackWriteAllowed } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return voltarParaConexoes({ meta: "erro", motivo: "cancelado" });

  let estado: ReturnType<typeof verificarEstado> = null;
  try {
    estado = verificarEstado(url.searchParams.get("state"), { segredo: env.INTERNAL_SECRET, agora: new Date() });
  } catch {
    estado = null;
  }
  if (!estado || !vinculoConfere(req.cookies.get(COOKIE_DO_VINCULO_META)?.value, estado.nonce, env.INTERNAL_SECRET)) {
    return voltarParaConexoes({ meta: "erro", motivo: "retorno_nao_verificavel" });
  }
  const { organizationId, userId } = estado;

  const admin = createAdminClient();
  const { data: vinculo } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!roleAtLeast((vinculo as { role?: string } | null)?.role, "admin")) {
    return voltarParaConexoes({ meta: "erro", motivo: "sem_permissao" });
  }

  if (!(await supportCallbackWriteAllowed(organizationId, userId, estado.authSessionId))) {
    return voltarParaConexoes({ meta: "erro", motivo: "retorno_nao_verificavel" });
  }
  // Uso único do `state` (mesma tabela de nonces da Agenda do Google): um
  // retorno repetido não reconecta nada nem reaproveita um código.
  const { error: nonceUsado } = await admin.from("calendar_oauth_nonces").insert({
    nonce: estado.nonce,
    organization_id: organizationId,
    user_id: userId,
    expira_em: new Date(estado.expiraEmMs).toISOString(),
  });
  if (nonceUsado) return voltarParaConexoes({ meta: "erro", motivo: "retorno_nao_verificavel" });

  const code = url.searchParams.get("code");
  const config = configDoLoginMeta();
  const { appSecret } = await appDaMeta();
  if (!code || !config || !appSecret) return voltarParaConexoes({ meta: "erro", motivo: "app_nao_configurado" });

  try {
    const tokenDoUsuario = await trocarCodigo(code, { appId: config.appId, appSecret, redirectUri: enderecoDeRetorno() });
    const contas = await listarContas(tokenDoUsuario);
    if (contas.length === 0) return voltarParaConexoes({ meta: "erro", motivo: "nenhuma_pagina" });
    const r = await conectarContas(admin, organizationId, contas);
    await audit({
      action: "channel.meta_social.connected",
      organizationId,
      metadata: {
        user_id: userId,
        conectadas: r.conectadas.length,
        em_outra_empresa: r.emOutraEmpresa.length,
        falhas: r.falhas.length,
      },
    });
    const resultado: Record<string, string> = {
      meta: r.conectadas.length ? "ok" : "erro",
      conectadas: String(r.conectadas.length),
    };
    if (r.emOutraEmpresa.length) resultado.em_outra_empresa = r.emOutraEmpresa.join(", ");
    if (r.falhas.length) resultado.falhas = r.falhas.join(", ");
    if (!r.conectadas.length) resultado.motivo = r.emOutraEmpresa.length ? "em_outra_empresa" : "falha";
    return voltarParaConexoes(resultado);
  } catch (err) {
    logger.warn("[meta-social] conexão falhou", {
      organization_id: organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return voltarParaConexoes({ meta: "erro", motivo: "meta_recusou" });
  }
}
