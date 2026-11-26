/**
 * O que as rotas de Relatórios têm em comum: papel `manager`, org ativa, fuso da
 * organização, período validado e o aviso quando a migration 9111 não rodou.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { validarPeriodo } from "@/lib/relatorios/periodo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

export type Contexto = {
  ok: true;
  supabase: SupabaseClient;
  orgId: string;
  tz: string;
  from: Date;
  to: Date;
  busca: URLSearchParams;
};

export async function lerContexto(
  req: NextRequest,
  requestId: string,
): Promise<Contexto | { ok: false; response: Response }> {
  const authz = await requireRole("manager", { requestId, resource: "reports" });
  if (!authz.ok) return { ok: false, response: authz.response };

  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: org } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  const tz = fusoUtilizavel((org as { timezone?: string | null } | null)?.timezone);

  const busca = req.nextUrl.searchParams;
  const periodo = validarPeriodo(
    busca.get("from") ?? undefined,
    busca.get("to") ?? undefined,
    new Date(),
    tz,
  );
  if (!periodo.ok) {
    return { ok: false, response: fail("validation_failed", periodo.mensagem, 422, { requestId }) };
  }
  return { ok: true, supabase, orgId: authz.org.orgId, tz, from: periodo.from, to: periodo.to, busca };
}

/** A função SQL não existe no banco (migration 9111 não aplicada). */
export function funcaoAusente(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST202" || code === "42883";
}

export const INDISPONIVEL = {
  disponivel: false as const,
  motivo:
    "Os relatórios precisam de uma atualização do banco (migration 9111). Peça a quem administra a instalação para aplicá-la.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidOuNulo(valor: string | null): string | null {
  return valor && UUID.test(valor) ? valor : null;
}

/** Nome e e-mail de cada pessoa, pelo mesmo caminho de /api/v1/team. */
export async function nomesDasPessoas(
  ids: readonly string[],
): Promise<Map<string, { nome: string | null; email: string | null }>> {
  const mapa = new Map<string, { nome: string | null; email: string | null }>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!isServiceRoleConfigured() || unicos.length === 0) return mapa;
  const admin = createAdminClient();
  await Promise.all(
    unicos.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      const u = data?.user;
      mapa.set(id, {
        nome: (u?.user_metadata?.full_name as string | undefined) ?? null,
        email: u?.email ?? null,
      });
    }),
  );
  return mapa;
}

export function comNome<T extends { user_id: string }>(
  nomes: Map<string, { nome: string | null; email: string | null }>,
) {
  return (x: T) => ({ ...x, ...(nomes.get(x.user_id) ?? { nome: null, email: null }) });
}
