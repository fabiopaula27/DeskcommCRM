/** DELETE /api/v1/channels/meta-social/[sessionId] — desconecta a página ou o Instagram. */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { desconectarConta } from "@/lib/channels/meta-social/conexao";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channels" });
  if (!auth.ok) return auth.response;
  const { sessionId } = await ctx.params;
  const feito = await desconectarConta(createAdminClient(), auth.org.orgId, sessionId);
  if (!feito) return fail("not_found", "Canal não encontrado.", 404, { requestId });
  await audit({
    action: "channel.meta_social.disconnected",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    resourceType: "channel_sessions",
    resourceId: sessionId,
    requestId,
  });
  return ok({ desconectado: true }, { requestId });
}
