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
import { limparPdfsAntigos } from "@/lib/relatorios/limpeza";
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
    .select("organization_id, ativo, frequencia, horario, emails, telefones, channel_session_id, ultimo_periodo, tentativas_do_periodo, telefones_pendentes")
    .eq("ativo", true)
    .order("updated_at", { ascending: true })
    .limit(TETO);
  if (error) {
    // Migration 9113 não aplicada: nada a fazer, sem erro em loop no log.
    if (error.code === "42P01" || error.code === "PGRST205") return ok({ enviados: 0, motivo: "sem_tabela" }, { requestId });
    logger.error("[report-schedules] leitura falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao ler agendamentos.", 500, { requestId });
  }

  // Limpeza dos PDFs com mais de 7 dias e das marcas de eco vencidas. Nunca impede o envio.
  try {
    await limparPdfsAntigos(admin.storage.from("relatorios") as never, new Date());
    await admin.from("report_send_marks").delete().lt("expires_at", new Date().toISOString());
  } catch (e) {
    logger.warn("[report-schedules] limpeza falhou", { error: e instanceof Error ? e.message : String(e), requestId });
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
    // Folga para o maxDuration de 300 s: empresa que não coube fica para a próxima rodada.
    prazoMs: 240_000,
    async reservar(orgId, chave) {
      const { data: reservado, error: erro } = await admin.rpc("fn_reservar_envio_de_relatorio" as never, {
        p_org: orgId,
        p_chave: chave,
      } as never);
      if (erro) {
        logger.error("[report-schedules] reserva falhou", { organization_id: orgId, error: erro.message, requestId });
        return false;
      }
      return reservado === true;
    },
    async reservarReenvio(orgId, chave) {
      const { data: lista, error: erro } = await admin.rpc("fn_reservar_reenvio_de_relatorio" as never, {
        p_org: orgId,
        p_chave: chave,
      } as never);
      if (erro) return null;
      const linhas = lista as unknown;
      if (Array.isArray(linhas) && linhas.length > 0 && Array.isArray(linhas[0])) return linhas[0] as string[];
      return Array.isArray(linhas) && linhas.every((x) => typeof x === "string") && linhas.length > 0 ? (linhas as string[]) : null;
    },
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
