/**
 * O token da PÁGINA de um canal Messenger/Instagram, decifrado. Sempre filtrado
 * pela organização (o client é service role) e só de canal ativo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

import { PROVIDER_META_SOCIAL } from "./constantes";
import type { PlataformaSocial } from "./parser";

export type CredencialDaConta = { token: string; paginaId: string; plataforma: PlataformaSocial };

export async function credencialDaConta(
  db: SupabaseClient,
  organizationId: string,
  contaId: string,
): Promise<CredencialDaConta | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("meta_social_token_encrypted, meta_social_page_id, meta_social_platform")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER_META_SOCIAL)
    .eq("meta_social_account_id", contaId)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const linha = data as { meta_social_token_encrypted: unknown; meta_social_page_id: string; meta_social_platform: PlataformaSocial };
  if (!linha.meta_social_token_encrypted) return null;
  const token = await decryptWebhookSecret(db as never, linha.meta_social_token_encrypted as string);
  if (!token) return null;
  return { token, paginaId: linha.meta_social_page_id, plataforma: linha.meta_social_platform };
}
