/**
 * Uma entrega do webhook da Meta (Messenger/Instagram) → mensagens no Inbox.
 *
 * Quem decide a ORGANIZAÇÃO é o canal ativo da conta (`entry.id`), nunca o
 * corpo: a mesma conta só pode estar ativa em uma organização (índice único da
 * migration 9116). Conta sem canal é ignorada. Um evento que falha não derruba
 * os outros, e nada aqui devolve erro à Meta (ela reentregaria para sempre).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

import { ingestZernioInbound } from "../zernio/ingest";
import { ehEcoDeEnvioEmVoo, JANELA_DO_ECO_MS } from "../eco-de-envio";
import { paraMensagemDoIngest, parsearEventos, type EventoSocial, type PlataformaSocial } from "./parser";

export const PROVIDER_META_SOCIAL = "meta_social";

export type SessaoDaConta = { id: string; organization_id: string };

/**
 * O canal ativo da conta do evento. Por FUNÇÃO no banco (migration 9116), não
 * por consulta solta: o webhook do app é um endereço só para todas as empresas,
 * então a organização só pode sair da conta — e o índice único parcial garante
 * no máximo um canal ativo por conta, o que torna a resolução exata.
 */
export async function sessaoDaConta(
  db: SupabaseClient,
  contaId: string,
  plataforma: PlataformaSocial,
): Promise<SessaoDaConta | null> {
  const { data, error } = await db.rpc("fn_canal_meta_social_da_conta", { p_conta: contaId, p_plataforma: plataforma });
  if (error) throw new Error(`meta_social_sessao: ${error.message}`);
  const linhas = (data ?? []) as SessaoDaConta[];
  return linhas[0] ?? null;
}

export type PerfilDoLead = { nome: string | null; usuario: string | null };

/** Nome (e @ no Instagram) do lead, com o token da página. Falha = sem nome, nunca erro. */
export async function perfilDoLead(
  db: SupabaseClient,
  organizationId: string,
  contaId: string,
  leadId: string,
  plataforma: PlataformaSocial,
): Promise<PerfilDoLead> {
  try {
    const { credencialDaConta } = await import("./credenciais");
    const { graphSocial } = await import("./graph");
    const cred = await credencialDaConta(db, organizationId, contaId);
    if (!cred) return { nome: null, usuario: null };
    const campos = plataforma === "instagram" ? "name,username" : "first_name,last_name,name";
    const p = await graphSocial<{ name?: string; first_name?: string; last_name?: string; username?: string }>(
      cred.token,
      leadId,
      { params: { fields: campos } },
    );
    const nome = p.name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || null);
    return { nome, usuario: p.username ?? null };
  } catch {
    return { nome: null, usuario: null };
  }
}

/**
 * O eco é de um envio do PRÓPRIO CRM? Então já existe (ou vai existir) a linha
 * da mensagem, e gravá-lo de novo duplicaria o balão e pausaria a IA como se
 * alguém tivesse respondido pelo celular.
 *  1. Messenger: o eco traz `app_id` — igual ao app do CRM, é nosso.
 *  2. Sem `app_id` (Instagram): envio nosso ainda em voo na conversa
 *     (`ehEcoDeEnvioEmVoo`, o mesmo guarda dos outros canais) ou a LEGENDA de
 *     uma mídia que acabamos de mandar (ela sai como uma segunda mensagem).
 */
export async function ehEcoDoCrm(
  db: SupabaseClient,
  e: EventoSocial,
  sessao: SessaoDaConta,
  appDoCrm: string | null = process.env.META_APP_ID?.trim() || null,
): Promise<boolean> {
  if (!e.eco) return false;
  if (e.appId && appDoCrm) return e.appId === appDoCrm;
  const { data: conversa } = await db
    .from("conversations")
    .select("id")
    .eq("organization_id", sessao.organization_id)
    .eq("channel_session_id", sessao.id)
    .eq("provider_conversation_id", e.leadId)
    .maybeSingle();
  const conversationId = (conversa as { id: string } | null)?.id;
  if (!conversationId) return false;
  if (
    await ehEcoDeEnvioEmVoo(db, {
      organizationId: sessao.organization_id,
      conversationId,
      corpo: e.texto,
      ehMidia: e.anexos.length > 0,
      tag: "meta-social.entrega",
    })
  ) {
    return true;
  }
  const texto = (e.texto ?? "").trim();
  if (!texto || e.anexos.length > 0) return false;
  const { data: legendas } = await db
    .from("messages")
    .select("id")
    .eq("organization_id", sessao.organization_id)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .in("sent_via", ["ai", "user", "automation", "system"])
    .neq("type", "text")
    .eq("body", texto)
    .gte("created_at", new Date(Date.now() - JANELA_DO_ECO_MS).toISOString())
    .limit(1);
  return (legendas ?? []).length > 0;
}

export type ResultadoDaEntrega = { recebidos: number; gravados: number; ignorados: number; falhas: number };

export async function processarEntrega(
  db: SupabaseClient,
  payload: unknown,
  deps: {
    ingerir?: typeof ingestZernioInbound;
    sessao?: typeof sessaoDaConta;
    perfil?: typeof perfilDoLead;
    ecoDoCrm?: typeof ehEcoDoCrm;
  } = {},
): Promise<ResultadoDaEntrega> {
  const ingerir = deps.ingerir ?? ingestZernioInbound;
  const acharSessao = deps.sessao ?? sessaoDaConta;
  const lerPerfil = deps.perfil ?? perfilDoLead;
  const ecoDoCrm = deps.ecoDoCrm ?? ehEcoDoCrm;
  const eventos = parsearEventos(payload);
  const r: ResultadoDaEntrega = { recebidos: eventos.length, gravados: 0, ignorados: 0, falhas: 0 };
  for (const e of eventos) {
    try {
      const sessao = await acharSessao(db, e.contaId, e.plataforma);
      if (!sessao) {
        r.ignorados++;
        continue;
      }
      if (await ecoDoCrm(db, e, sessao)) {
        r.ignorados++;
        continue;
      }
      const mensagem = paraMensagemDoIngest(e);
      if (!e.eco) {
        const perfil = await lerPerfil(db, sessao.organization_id, e.contaId, e.leadId, e.plataforma);
        mensagem.identity = { ...mensagem.identity, displayName: perfil.nome, username: perfil.usuario };
      }
      await ingerir(db, {
        organizationId: sessao.organization_id,
        channelSessionId: sessao.id,
        payload,
        socialMessage: mensagem,
      });
      r.gravados++;
    } catch (err) {
      r.falhas++;
      logger.error("[meta-social] evento não gravado", {
        conta: e.contaId,
        plataforma: e.plataforma,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return r;
}
