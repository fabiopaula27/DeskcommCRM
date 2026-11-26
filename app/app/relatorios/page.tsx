import type { Metadata } from "next";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { diaNoFuso } from "@/lib/relatorios/periodo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isServiceRoleConfigured } from "@/lib/audit";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import { RelatoriosClient, type FunilOpcao, type Pessoa } from "./_components/RelatoriosClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatórios" };

export default async function RelatoriosPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  const t = (texto: string) => traduzir(texto, user.idioma);

  // Dono e gerentes. Abaixo disso a página explica, sem mostrar número nenhum.
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Relatórios")}</h1>
        <p className="mt-2 text-sm text-text-muted">
          {t("Os relatórios da empresa são vistos pelo dono e pelos gerentes.")}
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: org }, { data: membros }, { data: pipelines }] = await Promise.all([
    supabase.from("organizations").select("timezone, currency").eq("id", activeOrg.orgId).maybeSingle(),
    supabase
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", activeOrg.orgId)
      .is("revoked_at", null),
    supabase
      .from("crm_pipelines")
      .select("id, name, position")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position"),
  ]);

  const tz = fusoUtilizavel(org?.timezone ?? null);
  const hoje = diaNoFuso(new Date(), tz);

  let pessoas: Pessoa[] = (membros ?? []).map((m) => ({ user_id: m.user_id, nome: m.user_id.slice(0, 8) }));
  if (isServiceRoleConfigured() && pessoas.length > 0) {
    const admin = createAdminClient();
    pessoas = await Promise.all(
      pessoas.map(async (p) => {
        const { data } = await admin.auth.admin.getUserById(p.user_id);
        const u = data?.user;
        const nome = (u?.user_metadata?.full_name as string | undefined) ?? u?.email ?? p.nome;
        return { user_id: p.user_id, nome };
      }),
    );
    pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }
  const funis: FunilOpcao[] = (pipelines ?? []).map((p) => ({ id: p.id, nome: p.name }));

  return (
    <RelatoriosClient
      periodoInicial={{ from: `${hoje.slice(0, 8)}01`, to: hoje }}
      tz={tz}
      moeda={org?.currency || "BRL"}
      pessoas={pessoas}
      funis={funis}
    />
  );
}
