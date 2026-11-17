import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET /api/v1/channels/evolution/[id]/qr — QR (base64) e código de pareamento.
 *
 * Mesmas guardas de `GET /api/v1/channel-sessions/[id]/qr`: suporte com
 * escrita, usuário autenticado, organização ativa; canal arquivado → 409. A
 * apikey do servidor nunca sai daqui — o browser só recebe a imagem.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { loadAuthUser } from "@/lib/auth/server";
import { EvolutionConnectionError, qrDaEvolution } from "@/lib/channels/connect-evolution";
import { createEvolutionClient } from "@/lib/channels/evolution/client";
import { evolutionConfigurado } from "@/lib/channels/evolution/credentials";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await params;

  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const ativa = await orgAtivaDaApi(user, requestId);
  if (!ativa.ok) return ativa.response;
  if (!ativa.org) return fail("forbidden_tenant", "Nenhuma organização ativa.", 403, { requestId });

  const client = evolutionConfigurado() ? createEvolutionClient() : null;
  try {
    const r = await qrDaEvolution(await createClient(), ativa.org.orgId, id, client);
    return ok({ qr_base64: r.qrBase64, pairing_code: r.pairingCode }, { requestId });
  } catch (error) {
    const t = (texto: string) => traduzir(texto, user.idioma);
    if (error instanceof EvolutionConnectionError) {
      const msg =
        error.code === "channel_archived"
          ? t("Este canal foi excluído. Conecte um número novo para voltar a usá-lo.")
          : error.code === "not_found"
            ? t("Canal não encontrado.")
            : error.code === "evolution_nao_configurado"
              ? t("O WhatsApp por QR não está configurado neste ambiente.")
              : t("Não foi possível obter o QR. Tente novamente.");
      return fail(error.code, msg, error.status, { requestId });
    }
    return fail("internal_error", t("Não foi possível obter o QR. Tente novamente."), 500, { requestId });
  }
}
