/**
 * GET/PUT /api/v1/reports/schedule — a configuração do envio agendado.
 * Só dono/admin (`requireRole("admin")`): é quem decide para onde os números da
 * empresa vão. A tabela não tem policy para `authenticated` (9113); o acesso é
 * pelo service role, SEMPRE filtrado pela org ativa da sessão.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { PROVIDERS_DO_ENVIO } from "@/lib/relatorios/envio-real";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const telefone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "use o formato +5516999999999");
const corpo = z.object({
  ativo: z.boolean(),
  frequencia: z.enum(["diario", "semanal", "mensal"]),
  horario: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário no formato HH:MM"),
  emails: z.array(z.string().trim().email()).max(20),
  telefones: z.array(telefone).max(20),
  channel_session_id: z.string().uuid().nullable(),
});

async function canais(admin: ReturnType<typeof createAdminClient>, orgId: string) {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, display_name, phone_number, provider, status")
    .eq("organization_id", orgId)
    .in("provider", [...PROVIDERS_DO_ENVIO]);
  return ((data ?? []) as { id: string; display_name: string | null; phone_number: string | null; provider: string; status: string }[]).map(
    (c) => ({ id: c.id, nome: c.display_name || c.phone_number || "WhatsApp", telefone: c.phone_number, conectado: c.status === "WORKING" }),
  );
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "report_schedule" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("report_schedules")
    .select("ativo, frequencia, horario, emails, telefones, channel_session_id, ultimo_envio_em, ultimo_erro, ultimo_periodo")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    return ok({ disponivel: false, motivo: "O envio agendado precisa de uma atualização do banco (migration 9113)." }, { requestId });
  }
  if (error) return fail("internal_error", "Não consegui ler o agendamento.", 500, { requestId });
  return ok({ disponivel: true, agendamento: data ?? null, canais: await canais(admin, authz.org.orgId) }, { requestId });
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "report_schedule" });
  if (!authz.ok) return authz.response;

  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    return fail("validation_failed", primeiro?.message ?? "Dados inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }
  const v = parsed.data;
  const admin = createAdminClient();

  if (v.telefones.length > 0) {
    if (!v.channel_session_id) return fail("validation_failed", "Escolha o número de WhatsApp que vai enviar.", 422, { requestId });
    const lista = await canais(admin, authz.org.orgId);
    if (!lista.some((c) => c.id === v.channel_session_id)) {
      return fail("validation_failed", "Esse número não pertence à empresa ou não é um número por QR Code.", 422, { requestId });
    }
  }

  const { error } = await admin.from("report_schedules").upsert(
    {
      organization_id: authz.org.orgId,
      ativo: v.ativo,
      frequencia: v.frequencia,
      horario: v.horario,
      emails: [...new Set(v.emails.map((e) => e.toLowerCase()))],
      telefones: [...new Set(v.telefones)],
      channel_session_id: v.telefones.length > 0 ? v.channel_session_id : null,
      updated_by: authz.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) return fail("internal_error", "Não consegui salvar o agendamento.", 500, { requestId });

  await audit({
    action: "report_schedule.updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "report_schedules",
    resourceId: null,
    requestId,
    metadata: { frequencia: v.frequencia, horario: v.horario, emails: v.emails.length, telefones: v.telefones.length, ativo: v.ativo },
  });
  return ok({ salvo: true }, { requestId });
}
