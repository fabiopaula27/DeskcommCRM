/**
 * Aplica o texto inbound aos follow-ups vivos do contato e manda o
 * próximo passo neste mesmo request. O gatilho é a resposta do lead,
 * não o relógio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { idsDoContatoEGemeos } from "@/lib/channels/contato-por-telefone";
import { ehOperante } from "@/lib/organizacao/operante";

import { enviarTextoFixoPendente } from "./enviar-texto-fixo";
import {
  aplicarRespostaInbound,
  avancarEnrollmentAtivo,
  createSupabaseAdminClient,
  type TickDeps,
} from "./engine";
import type { EnrollmentRow } from "./node-handlers";

export type SinalDeInboundFollowup = {
  organizationId: string;
  contactId: string;
  texto?: string | null;
};

export function textoDoPayloadInbound(payload: Record<string, unknown> | null | undefined): string {
  const preview = payload?.body_preview;
  if (typeof preview === "string" && preview.trim()) return preview.trim();
  const body = payload?.body;
  if (typeof body === "string" && body.trim()) return body.trim();
  return "";
}

function tickDepsDe(admin: SupabaseClient): TickDeps {
  return {
    db: createSupabaseAdminClient(admin),
    clock: () => new Date(),
    enqueueJob: async (job) => {
      const { error } = await admin.from("job_queue").insert({
        organization_id: job.organization_id,
        contact_id: job.contact_id,
        kind: "followup_turn",
        payload: job.payload,
      });
      if (error) throw new Error(error.message);
    },
  };
}

/**
 * Uma mensagem do lead vale para UM `match_reply`. Reaplicar o mesmo texto
 * no passo seguinte (endereço, motivo…) pula a pergunta.
 *
 * `esperaDesde` = `enrollment.updated_at` no momento em que o nó estacionou
 * em `waiting_reply` (confirmação de nome, pergunta de endereço, etc.).
 */
export function inboundEhDestaPergunta(enviadaEm: string, esperaDesde: string): boolean {
  // Instante, não texto: `+00:00` contra `Z`, e segundo inteiro contra milissegundo,
  // decidiam a comparação pela forma da string.
  const a = Date.parse(enviadaEm);
  const b = Date.parse(esperaDesde);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return enviadaEm >= esperaDesde;
  return a >= b;
}

/**
 * O instante que vale para "esta mensagem é resposta desta pergunta?": o MAIS
 * CEDO entre o horário do WhatsApp (`sent_at`) e o da gravação no servidor
 * (`created_at`). O do WhatsApp pode estar segundos à frente do relógio do
 * servidor — e aí a resposta da pergunta anterior parecia posterior ao início
 * da pergunta seguinte. O da gravação sozinho erraria no histórico importado
 * (gravado agora, enviado há dias). O mais cedo dos dois erra para o lado seguro.
 */
export function instanteDaMensagem(sentAt: unknown, createdAt: unknown): string | null {
  const ok = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
  if (ok(sentAt) && ok(createdAt)) return Date.parse(sentAt) <= Date.parse(createdAt) ? sentAt : createdAt;
  return ok(sentAt) ? sentAt : ok(createdAt) ? createdAt : null;
}

/**
 * Desde quando a pergunta ATUAL espera, pelo relógio do BANCO: o `created_at`
 * do último `wait_started` do nó. `updated_at` vem do relógio do servidor da
 * aplicação; com a VPS segundos atrás do banco, a resposta da pergunta anterior
 * (carimbada pelo banco) parecia posterior a esta e a respondia também.
 */
export async function inicioDaEsperaNoBanco(
  admin: SupabaseClient,
  organizationId: string,
  enrollmentId: string,
  nodeId: string | null | undefined,
): Promise<string | null> {
  if (!nodeId) return null;
  const { data, error } = await admin
    .from("followup_enrollment_events")
    .select("created_at")
    .eq("organization_id", organizationId)
    .eq("enrollment_id", enrollmentId)
    .eq("node_id", nodeId)
    .eq("event_type", "wait_started")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const v = (data as { created_at?: unknown } | null)?.created_at;
  return typeof v === "string" ? v : null;
}

/** O piso da pergunta: o MAIS TARDE entre o relógio da aplicação e o do banco. */
export function pisoDaPergunta(updatedAt: string, inicioNoBanco: string | null): string {
  if (!inicioNoBanco) return updatedAt;
  const a = Date.parse(updatedAt);
  const b = Date.parse(inicioNoBanco);
  if (!Number.isFinite(a)) return inicioNoBanco;
  if (!Number.isFinite(b)) return updatedAt;
  return b > a ? inicioNoBanco : updatedAt;
}

type InboundResolvido = { texto: string; enviadaEm: string | null };

async function ultimoInboundDoContato(
  admin: SupabaseClient,
  orgId: string,
  contactIds: string[],
): Promise<InboundResolvido> {
  const { data, error } = await admin
    .from("messages")
    .select("body, sent_at, created_at")
    .eq("organization_id", orgId)
    .in("contact_id", contactIds)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const texto = typeof data?.body === "string" ? data.body.trim() : "";
  const enviadaEm = instanteDaMensagem(data?.sent_at, (data as { created_at?: unknown } | null)?.created_at);
  return { texto, enviadaEm };
}

async function aplicarTextoAosEnrollmentsEmEspera(
  admin: SupabaseClient,
  orgId: string,
  contactIds: string[],
  texto: string,
  enviadaEm: string | null,
  deps: TickDeps,
  jaRespondidas: Set<string>,
): Promise<number> {
  const { data, error } = await admin
    .from("followup_enrollments")
    .select("*")
    .eq("organization_id", orgId)
    .in("contact_id", contactIds)
    .eq("status", "waiting_reply");
  if (error) throw new Error(error.message);
  let aplicados = 0;
  for (const row of data ?? []) {
    const enrollment = row as EnrollmentRow;
    // Sem sent_at não dá pra saber se a mensagem é desta pergunta — fail-closed
    // (igual ao relógio): não avança com texto velho.
    if (!enviadaEm) continue;
    const piso = pisoDaPergunta(
      enrollment.updated_at,
      await inicioDaEsperaNoBanco(admin, orgId, enrollment.id, enrollment.current_node_id),
    );
    if (!inboundEhDestaPergunta(enviadaEm, piso)) continue;
    // UMA mensagem responde UMA pergunta. O laço abaixo roda até 6 vezes no
    // mesmo request: a resposta "3" do menu levava o fluxo à pergunta seguinte,
    // que entrava em `waiting_reply` e, na volta seguinte do laço, recebia o
    // MESMO "3" — bastava o relógio do WhatsApp estar alguns segundos à frente
    // do servidor para a guarda de horário acima deixar passar.
    if (jaRespondidas.has(enrollment.id)) continue;
    jaRespondidas.add(enrollment.id);
    await aplicarRespostaInbound(deps, enrollment, texto);
    aplicados++;
  }
  return aplicados;
}

/**
 * Avança enrollments `active` já vencidos deste contato e manda o texto fixo
 * neste request. O gatilho de retorno usa isto porque o cron de 1 minuto
 * chega tarde demais para quem ACABOU de escrever.
 */
export async function avancarFollowupsAtivosDoContato(
  admin: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<void> {
  const contactIds = await idsDoContatoEGemeos(admin, organizationId, contactId);
  const deps = tickDepsDe(admin);
  for (let i = 0; i < 6; i++) {
    const agora = new Date().toISOString();
    const { data: vivos, error: vivosErr } = await admin
      .from("followup_enrollments")
      .select("*")
      .eq("organization_id", organizationId)
      .in("contact_id", contactIds)
      .eq("status", "active")
      .lte("next_eval_at", agora)
      .limit(8);
    if (vivosErr) throw new Error(vivosErr.message);
    for (const row of vivos ?? []) {
      await avancarEnrollmentAtivo(deps, row as EnrollmentRow);
    }
    const enviados = await enviarTextoFixoPendente(admin, contactIds);
    if (!(vivos?.length) && !enviados) break;
  }
}

export async function aplicarTextoNosFollowups(
  admin: SupabaseClient,
  sinal: SinalDeInboundFollowup,
): Promise<void> {
  // Org parada não avança fluxo nem envia (spec cobrança do revendedor §1.3). O
  // handler de reatividade continua rodando para ela por causa do opt-out e do
  // handoff (`applyReactivityEvent`); só este passo, que enfileira e envia, para.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("status")
    .eq("id", sinal.organizationId)
    .maybeSingle();
  if (orgErr) throw new Error(orgErr.message);
  if (!ehOperante((org as { status?: string } | null)?.status)) return;

  // Contato pessoal (spec 21, caminho 4): o texto dele não alimenta follow-up
  // nenhum — nem acorda espera, nem responde pergunta. O que estava vivo já
  // caiu no marcar (etapa 4) ou na reatividade acima; aqui é só não tocar.
  const { data: contato, error: contatoErr } = await admin
    .from("contacts")
    .select("is_personal")
    .eq("organization_id", sinal.organizationId)
    .eq("id", sinal.contactId)
    .maybeSingle();
  if (contatoErr) throw new Error(contatoErr.message);
  if ((contato as { is_personal?: boolean } | null)?.is_personal === true) return;

  const contactIds = await idsDoContatoEGemeos(admin, sinal.organizationId, sinal.contactId);
  const ultimo = await ultimoInboundDoContato(admin, sinal.organizationId, contactIds);
  const texto = (sinal.texto?.trim() || ultimo.texto).trim();
  if (!texto) return;
  const enviadaEm = ultimo.enviadaEm;
  const deps = tickDepsDe(admin);

  // Apply dentro do loop (não numa 2ª passada cega): a mensagem que ENFILEIROU
  // a confirmação de nome não pode responder a essa confirmação no mesmo request.
  // `inboundEhDestaPergunta` exige sent_at >= updated_at do waiting_reply.
  const jaRespondidas = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const aplicados = await aplicarTextoAosEnrollmentsEmEspera(
      admin,
      sinal.organizationId,
      contactIds,
      texto,
      enviadaEm,
      deps,
      jaRespondidas,
    );
    const agora = new Date().toISOString();
    const { data: vivos, error: vivosErr } = await admin
      .from("followup_enrollments")
      .select("*")
      .eq("organization_id", sinal.organizationId)
      .in("contact_id", contactIds)
      .eq("status", "active")
      .lte("next_eval_at", agora)
      .limit(8);
    if (vivosErr) throw new Error(vivosErr.message);
    for (const row of vivos ?? []) {
      await avancarEnrollmentAtivo(deps, row as EnrollmentRow);
    }
    const enviados = await enviarTextoFixoPendente(admin, contactIds);
    if (!aplicados && !(vivos?.length) && !enviados) break;
  }
}
