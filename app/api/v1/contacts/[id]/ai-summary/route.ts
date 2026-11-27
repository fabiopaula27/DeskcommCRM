/**
 * POST /api/v1/contacts/[id]/ai-summary — "Resumo da IA" do lead.
 * Junta ficha, anotações, tarefas, negócios, agendamentos e as últimas
 * mensagens e pede à IA um texto curto. Sem dados: responde sem chamar a IA.
 * Modelo: o do ponto `draft_suggestion` (ajudante do atendente).
 */
import { randomUUID } from "node:crypto";

import { generateText } from "ai";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { tabelaAusente } from "@/lib/contatos/anotacoes";
import {
  INSTRUCOES_DO_RESUMO,
  RESUMO_SEM_DADOS,
  haPoucaInformacao,
  montarContextoDoLead,
  type DadosDoLead,
} from "@/lib/contatos/resumo-do-lead";
import { logger } from "@/lib/logger";
import { MARCADOR_NAO_LIDA } from "@/lib/messaging/media/derivable";
import { fusoUtilizavel } from "@/lib/tempo/fusos";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

import { contextoDasAnotacoes, type Ctx } from "../notes/_comum";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Linha = Record<string, unknown>;

export async function POST(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const c = await contextoDasAnotacoes(ctx, requestId, "agent");
  if (!c.ok) return c.response;
  const db = c.supabase;

  const [org, contato, notas, tarefas, negocios, agenda, msgs] = await Promise.all([
    db.from("organizations").select("timezone").eq("id", c.orgId).maybeSingle(),
    db.from("contacts").select("name, display_name, phone_number, email, source, created_at, tags, custom_fields").eq("id", c.contatoId).eq("organization_id", c.orgId).maybeSingle(),
    db.from("contact_notes").select("kind, body, created_by, created_at").eq("organization_id", c.orgId).eq("contact_id", c.contatoId).order("created_at", { ascending: true }).limit(100),
    db.from("crm_tasks").select("title, status, due_date, description").eq("organization_id", c.orgId).eq("contact_id", c.contatoId).order("created_at", { ascending: true }).limit(50),
    db.from("crm_leads").select("title, status, value_cents, crm_stages!crm_leads_stage_id_fkey(name)").eq("organization_id", c.orgId).eq("contact_id", c.contatoId).order("created_at", { ascending: false }).limit(10),
    db.from("calendar_appointments").select("title, starts_at, status").eq("organization_id", c.orgId).eq("contact_id", c.contatoId).order("starts_at", { ascending: false }).limit(10),
    db.from("messages").select("direction, body, type, media_derived_text, created_at").eq("organization_id", c.orgId).eq("contact_id", c.contatoId).order("created_at", { ascending: false }).limit(40),
  ]);

  const k = (contato.data ?? {}) as Linha;
  const linhasDeNotas = tabelaAusente(notas.error) ? [] : ((notas.data ?? []) as Linha[]);
  const nomes = await nomesDosAtendentes(linhasDeNotas.map((n) => n.created_by as string | null));

  const dados: DadosDoLead = {
    fuso: fusoUtilizavel((org.data as { timezone?: string | null } | null)?.timezone),
    contato: {
      nome: (k.name as string | null) ?? (k.display_name as string | null) ?? null,
      telefone: (k.phone_number as string | null) ?? null,
      email: (k.email as string | null) ?? null,
      origem: (k.source as string | null) ?? null,
      criadoEm: (k.created_at as string) ?? new Date().toISOString(),
      tags: Array.isArray(k.tags) ? (k.tags as string[]) : [],
      // Sem resumos antigos salvos na ficha: a IA reciclaria o próprio texto.
      campos: Object.fromEntries(
        Object.entries((k.custom_fields as Record<string, unknown> | null) ?? {}).filter(([chave]) => !/resumo/i.test(chave)),
      ),
    },
    anotacoes: linhasDeNotas.map((n) => ({
      criadaEm: n.created_at as string,
      autor: n.created_by ? (nomes.get(n.created_by as string) ?? null) : null,
      texto: (n.body as string | null) ?? null,
      kind: n.kind as "text" | "audio",
    })),
    tarefas: ((tarefas.data ?? []) as Linha[]).map((t) => ({
      titulo: t.title as string,
      status: t.status as string,
      prazo: (t.due_date as string | null) ?? null,
      descricao: (t.description as string | null) ?? null,
    })),
    negocios: ((negocios.data ?? []) as Linha[]).map((n) => ({
      titulo: n.title as string,
      etapa: ((n.crm_stages as { name?: string } | null)?.name as string | undefined) ?? null,
      status: n.status as string,
      valorCents: (n.value_cents as number | null) ?? null,
    })),
    agendamentos: ((agenda.data ?? []) as Linha[]).map((a) => ({
      titulo: (a.title as string | null) ?? "Agendamento",
      inicio: a.starts_at as string,
      status: a.status as string,
    })),
    mensagens: ((msgs.data ?? []) as Linha[])
      .map((m) => {
        const derivado = (m.media_derived_text as string | null) ?? "";
        const texto = ((m.body as string | null) ?? "").trim() || (derivado !== MARCADOR_NAO_LIDA ? derivado.trim() : "");
        return { em: m.created_at as string, deQuem: m.direction === "inbound" ? ("lead" as const) : ("empresa" as const), texto };
      })
      .filter((m) => m.texto)
      .reverse(),
  };

  const geradoEm = new Date().toISOString();
  if (haPoucaInformacao(dados)) return ok({ texto: RESUMO_SEM_DADOS, geradoEm, semDados: true }, { requestId });

  const modelo = await resolverModeloDoPonto("draft_suggestion", c.orgId, DEFAULT_CLASSIFIER_MODEL, {
    naFaltaUsarOPadraoDaOrganizacao: true,
  }).catch(() => null);
  if (!modelo) {
    return fail("ai_not_configured", "Nenhum modelo de IA configurado para a empresa (IA › Credenciais).", 409, { requestId });
  }
  try {
    const r = await generateText({
      model: modelo.model,
      system: INSTRUCOES_DO_RESUMO,
      prompt: montarContextoDoLead(dados),
      maxOutputTokens: 600,
    });
    const texto = r.text.trim();
    if (!texto) return fail("ai_empty", "A IA não devolveu resumo. Tente de novo.", 502, { requestId });
    await audit({
      action: "contact.ai_summary",
      actorUserId: c.userId,
      organizationId: c.orgId,
      resourceType: "contacts",
      resourceId: c.contatoId,
      requestId,
      metadata: { modelo: modelo.modelId, anotacoes: dados.anotacoes.length, mensagens: dados.mensagens.length },
    });
    return ok({ texto, geradoEm, semDados: false }, { requestId });
  } catch (err) {
    logger.warn("[resumo-do-lead] falhou", { organization_id: c.orgId, error: err instanceof Error ? err.message : String(err) });
    return fail("ai_failed", "A IA não respondeu agora. Tente de novo em instantes.", 502, { requestId });
  }
}
