/**
 * GET /api/v1/channels/meta-social — os canais Messenger/Instagram da empresa
 * e se o app da Meta está pronto para o botão "Conectar com Facebook".
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { appDaMeta } from "@/lib/channels/meta/app";
import { configDoLoginMeta } from "@/lib/channels/meta-social/conexao";
import { canaisMetaSocial } from "@/lib/channels/meta-social/lista";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("viewer", { requestId, resource: "channels" });
  if (!auth.ok) return auth.response;
  const db = await createClient();
  const canais = await canaisMetaSocial(db as never, auth.org.orgId);
  if (canais === null) return fail("internal_error", "Não consegui ler os canais.", 500, { requestId });
  const app = await appDaMeta();
  const config = configDoLoginMeta();
  const falta = [
    ...(config ? [] : ["META_APP_ID"]),
    ...(config?.configId ? [] : ["META_LOGIN_CONFIG_ID"]),
    ...(app.appSecret ? [] : ["META_APP_SECRET"]),
    ...(app.verifyToken ? [] : ["META_WEBHOOK_VERIFY_TOKEN"]),
  ];
  return ok(
    {
      canais,
      pronto: Boolean(config && app.appSecret && app.verifyToken),
      falta,
      podeConectar: roleAtLeast(auth.org.role, "admin"),
    },
    { requestId },
  );
}
