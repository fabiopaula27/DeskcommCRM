import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/channels/evolution/[id]/reconnect — pede QR novo para a mesma
 * instância (mesmo nome, token e segredo; recria se ela sumiu do servidor).
 * Mesmos papéis de `POST /api/v1/channel-sessions`. Canal arquivado → 409.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { EvolutionConnectionError, reconectarEvolution } from "@/lib/channels/connect-evolution";
import { createEvolutionClient } from "@/lib/channels/evolution/client";
import { evolutionConfigurado } from "@/lib/channels/evolution/credentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await params;
  const authz = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (await mfaEmDivida()) return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });

  const client = evolutionConfigurado() ? createEvolutionClient() : null;
  if (!client) {
    return fail("evolution_nao_configurado", t("O WhatsApp por QR não está configurado neste ambiente."), 503, { requestId });
  }
  try {
    const r = await reconectarEvolution(createAdminClient(), authz.org.orgId, id, client);
    return ok({ channel_session_id: id, qr_base64: r.qrBase64 }, { requestId });
  } catch (error) {
    if (error instanceof EvolutionConnectionError) {
      return fail(error.code, t("Não foi possível reconectar. Tente novamente."), error.status, { requestId });
    }
    return fail("internal_error", t("Não foi possível reconectar. Tente novamente."), 500, { requestId });
  }
}
