/** Os canais Messenger/Instagram da empresa, para a tela de Conexões. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { PROVIDER_META_SOCIAL } from "./constantes";
import type { PlataformaSocial } from "./parser";

export type CanalMetaSocial = {
  id: string;
  plataforma: PlataformaSocial;
  nome: string;
  status: string;
  conectadoEm: string;
};

type Linha = {
  id: string;
  meta_social_platform: PlataformaSocial;
  display_name: string | null;
  status: string;
  created_at: string;
};

/** `null` = erro de leitura; coluna ausente (migration 9116 não rodou) = lista vazia. */
export async function canaisMetaSocial(db: SupabaseClient, organizationId: string): Promise<CanalMetaSocial[] | null> {
  const { data, error } = await db
    .from("channel_sessions")
    .select("id, meta_social_platform, display_name, status, created_at")
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER_META_SOCIAL)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) return error.code === "42703" ? [] : null;
  return ((data ?? []) as Linha[]).map((l) => ({
    id: l.id,
    plataforma: l.meta_social_platform,
    nome: l.display_name ?? "",
    status: l.status,
    conectadoEm: l.created_at,
  }));
}
