/**
 * Cron do envio agendado dos Relatórios (migration 9113), a cada 15 minutos.
 * Quem decide se é hora é o relógio de cada organização (`lib/relatorios/agendamento.ts`).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { logger } from "@/lib/logger";
import { idsDeOrgsParadas } from "@/lib/organizacao/operante";
import { enviarRelatorio } from "@/lib/relatorios/envio";
import { dadosDaEmpresa, depsReais } from "@/lib/relatorios/envio-real";
import { rodarEnviosAgendados, type LinhaDoAgendamento } from "@/lib/relatorios/rodada";
import { createAdminClient } from "@/lib/supabase/admin";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TETO = 200;

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("report_schedules")
    .select("organization_id, ativo, frequencia, horario, emails, telefones, channel_session_id, ultimo_periodo, tentativas_do_periodo")
    .eq("ativo", true)
    .limit(TETO);
  if (error) {
    // Migration 9113 não aplicada: nada a fazer, sem erro em loop no log.
    if (error.code === "42P01" || error.code === "PGRST205") return ok({ enviados: 0, motivo: "sem_tabela" }, { requestId });
    logger.error("[report-schedules] leitura falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao ler agendamentos.", 500, { requestId });
  }

  const empresas = new Map<string, Awaited<ReturnType<typeof dadosDaEmpresa>>>();
  const empresa = async (orgId: string) => {
    if (!empresas.has(orgId)) empresas.set(orgId, await dadosDaEmpresa(admin, orgId));
    return empresas.get(orgId)!;
  };

  const resultado = await rodarEnviosAgendados({
    agendamentos: (data ?? []) as LinhaDoAgendamento[],
    paradas: new Set(await idsDeOrgsParadas(admin)),
    fusoDe: async (orgId) => fusoUtilizavel((await empresa(orgId)).tz),
    agora: new Date(),
    async enviar(linha, periodo, tz) {
      const e = await empresa(linha.organization_id);
      const deps = depsReais(admin, {
        orgId: linha.organization_id,
        tz,
        empresa: e.empresa,
        moeda: e.moeda,
        sistema: e.sistema,
        channelSessionId: linha.channel_session_id,
      });
      return enviarRelatorio(deps, { emails: linha.emails, telefones: linha.telefones, periodo, empresa: e.empresa });
    },
    async gravar(orgId, desfecho) {
      const { error: erro } = await admin
        .from("report_schedules")
        .update({ ...desfecho, updated_at: new Date().toISOString() })
        .eq("organization_id", orgId);
      if (erro) logger.error("[report-schedules] desfecho não gravado", { organization_id: orgId, error: erro.message, requestId });
    },
  });

  return ok(resultado, { requestId });
}

export const GET = handle;
export const POST = handle;
