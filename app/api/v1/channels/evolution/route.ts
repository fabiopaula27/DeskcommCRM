import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/channels/evolution — conecta um número por QR (Evolution API).
 *
 * Mesmos papéis de `POST /api/v1/channel-sessions`: admin (ou admin de
 * plataforma), escrita de suporte liberada e MFA em dia. Exige o header
 * `Idempotency-Key` (uuid). Sem as variáveis do servidor → 503
 * `evolution_nao_configurado`. Teto do plano → 409 traduzido.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { mfaEmDivida } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { EvolutionConnectionError, conectarEvolution } from "@/lib/channels/connect-evolution";
import { createEvolutionClient } from "@/lib/channels/evolution/client";
import { evolutionConfigurado } from "@/lib/channels/evolution/credentials";
import { traduzirLimiteDoPlano } from "@/lib/cobranca/limites";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ display_name: z.string().trim().min(1).max(100).optional() });

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channel_sessions", allowPlatformAdmin: true });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (await mfaEmDivida()) return fail("mfa_required", t("Confirme a verificação em duas etapas."), 403, { requestId });

  const client = evolutionConfigurado() ? createEvolutionClient() : null;
  if (!client) {
    return fail("evolution_nao_configurado", t("O WhatsApp por QR não está configurado neste ambiente."), 503, { requestId });
  }

  const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) return fail("validation_failed", t("Dados inválidos."), 422, { requestId });

  try {
    const r = await conectarEvolution(await createClient(), createAdminClient(), client, {
      organizationId: authz.org.orgId,
      userId: authz.user.id,
      displayName: parsed.data.display_name,
      idempotencyKey: req.headers.get("Idempotency-Key") ?? "",
    });
    return ok({ channel_session_id: r.channelSessionId, qr_base64: r.qrBase64 }, { requestId, status: 201 });
  } catch (error) {
    const limite = traduzirLimiteDoPlano(error, authz.user.idioma);
    if (limite) return fail(limite.code, limite.message, 409, { requestId, details: limite.details });
    if (error instanceof EvolutionConnectionError) {
      return fail(error.code, t("Não foi possível concluir a conexão. Tente novamente."), error.status, { requestId });
    }
    return fail("internal_error", t("Não foi possível concluir a conexão. Tente novamente."), 500, { requestId });
  }
}
