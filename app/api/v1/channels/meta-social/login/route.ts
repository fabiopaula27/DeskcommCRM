/**
 * GET /api/v1/channels/meta-social/login — "Conectar com Facebook".
 * Dono/administrador da empresa. Leva à janela da Meta com um `state` assinado
 * (organização + pessoa + nonce) e um cookie de vínculo Lax que prova, na volta,
 * que quem voltou é quem saiu.
 */
import { randomBytes } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { emitirEstado } from "@/lib/agenda/google/estado";
import { assinarVinculo, VALIDADE_DO_VINCULO_S } from "@/lib/agenda/google/vinculo";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { CAMINHO_DO_RETORNO_META, configDoLoginMeta, urlDoLogin } from "@/lib/channels/meta-social/conexao";
import { COOKIE_DO_VINCULO_META, enderecoDeRetorno, voltarParaConexoes } from "@/lib/channels/meta-social/volta";
import { env } from "@/lib/env";
import { authenticatedSessionId, requireSupportWrite } from "@/lib/impersonate/support";
import { cookieSecure } from "@/lib/supabase/cookie-secure";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const auth = await requireRole("admin", { requestId: req.headers.get("x-request-id") ?? undefined, resource: "channels" });
  if (!auth.ok) return auth.response;

  const config = configDoLoginMeta();
  if (!config) return voltarParaConexoes({ meta: "erro", motivo: "app_nao_configurado" });

  const nonce = randomBytes(16).toString("base64url");
  let state: string;
  try {
    state = emitirEstado(
      { organizationId: auth.org.orgId, userId: auth.user.id, authSessionId: await authenticatedSessionId() },
      { segredo: env.INTERNAL_SECRET, agora: new Date(), nonce },
    );
  } catch {
    return voltarParaConexoes({ meta: "erro", motivo: "segredo_indisponivel" });
  }
  await audit({
    action: "channel.meta_social.connect_started",
    organizationId: auth.org.orgId,
    metadata: { user_id: auth.user.id },
  });

  const resposta = NextResponse.redirect(urlDoLogin(config, enderecoDeRetorno(), state));
  resposta.cookies.set(COOKIE_DO_VINCULO_META, assinarVinculo(nonce, env.INTERNAL_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: CAMINHO_DO_RETORNO_META,
    maxAge: VALIDADE_DO_VINCULO_S,
  });
  return resposta;
}
