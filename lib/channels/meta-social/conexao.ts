/**
 * "Conectar com Facebook": login da Meta (Facebook Login for Business, com
 * `config_id`), troca do código por token, e um canal por página (Messenger)
 * e por Instagram profissional ligado a ela (Direct).
 *
 * A escolha das páginas acontece NA JANELA DA META: o CRM conecta tudo o que a
 * pessoa autorizou lá, e qualquer canal pode ser desconectado depois.
 * O token guardado é o da PÁGINA, que não expira quando vem de um token de
 * usuário de longa duração; o Instagram usa o token da página a que está ligado.
 */
import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metadataInicialDoCanal } from "@/lib/ai/elegibilidade/pre-go-live";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";

import { credencialDaConta } from "./credenciais";
import { PROVIDER_META_SOCIAL } from "./entrega";
import { GRAPH_SOCIAL, graphSocial } from "./graph";
import type { PlataformaSocial } from "./parser";

export const CAMINHO_DO_RETORNO_META = "/api/v1/channels/meta-social/callback";
export const PERMISSOES_DO_LOGIN = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
] as const;
export const CAMPOS_DA_PAGINA = "messages,messaging_postbacks,message_echoes";

export type ConfigDoLogin = { appId: string; configId: string | null };

/** App ID e ID de configuração do login. Sem App ID não há botão. */
export function configDoLoginMeta(env: Record<string, string | undefined> = process.env): ConfigDoLogin | null {
  const appId = env.META_APP_ID?.trim();
  if (!appId) return null;
  return { appId, configId: env.META_LOGIN_CONFIG_ID?.trim() || null };
}

export function urlDoLogin(c: ConfigDoLogin, redirectUri: string, state: string): string {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", c.appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  if (c.configId) {
    u.searchParams.set("config_id", c.configId);
    u.searchParams.set("override_default_response_type", "true");
  } else {
    u.searchParams.set("scope", PERMISSOES_DO_LOGIN.join(","));
  }
  return u.toString();
}

/** Código → token de usuário de LONGA duração (as páginas herdam token sem validade). */
export async function trocarCodigo(
  code: string,
  app: { appId: string; appSecret: string; redirectUri: string },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const pedir = async (params: Record<string, string>) => {
    const u = new URL(`${GRAPH_SOCIAL}/oauth/access_token`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetcher(u);
    const j = (await res.json().catch(() => null)) as { access_token?: string; error?: { message?: string } } | null;
    if (!res.ok || !j?.access_token) throw new Error(`meta_oauth: ${j?.error?.message ?? res.status}`);
    return j.access_token;
  };
  const curto = await pedir({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: app.redirectUri, code });
  return pedir({ grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: curto });
}

export type ContaAutorizada = {
  plataforma: PlataformaSocial;
  contaId: string;
  paginaId: string;
  nome: string;
  tokenDaPagina: string;
};

/** Páginas autorizadas e o Instagram profissional de cada uma. */
export async function listarContas(tokenDoUsuario: string, fetcher: typeof fetch = fetch): Promise<ContaAutorizada[]> {
  type Pagina = {
    id: string;
    name: string;
    access_token?: string;
    instagram_business_account?: { id: string; username?: string };
  };
  const r = await graphSocial<{ data?: Pagina[] }>(
    tokenDoUsuario,
    "me/accounts",
    { params: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100" } },
    fetcher,
  );
  const contas: ContaAutorizada[] = [];
  for (const p of r.data ?? []) {
    if (!p.access_token) continue;
    contas.push({ plataforma: "facebook", contaId: p.id, paginaId: p.id, nome: p.name, tokenDaPagina: p.access_token });
    const ig = p.instagram_business_account;
    if (ig?.id) {
      contas.push({
        plataforma: "instagram",
        contaId: ig.id,
        paginaId: p.id,
        nome: ig.username ? `@${ig.username}` : p.name,
        tokenDaPagina: p.access_token,
      });
    }
  }
  return contas;
}

export type ResultadoDaConexao = { conectadas: string[]; emOutraEmpresa: string[]; falhas: string[] };

/** Violação do índice único: a conta já está ATIVA em outra empresa. */
const CONTA_JA_ATIVA = "23505";

/**
 * Cria (ou atualiza, se já ativo na MESMA empresa) os canais e inscreve cada
 * página no app. Quem barra a mesma conta em duas empresas é o índice único
 * parcial da 9116 — o CRM nunca lê canal de outra organização.
 */
export async function conectarContas(
  db: SupabaseClient,
  organizationId: string,
  contas: ContaAutorizada[],
  fetcher: typeof fetch = fetch,
): Promise<ResultadoDaConexao> {
  const r: ResultadoDaConexao = { conectadas: [], emOutraEmpresa: [], falhas: [] };
  const paginasInscritas = new Set<string>();
  for (const c of contas) {
    const tokenCifrado = await encryptWebhookSecret(db, c.tokenDaPagina);
    if (!tokenCifrado) {
      r.falhas.push(c.nome);
      continue;
    }
    const campos = {
      meta_social_token_encrypted: tokenCifrado,
      meta_social_page_id: c.paginaId,
      meta_social_platform: c.plataforma,
      display_name: `${c.plataforma === "instagram" ? "Instagram" : "Messenger"} · ${c.nome}`,
      status: "WORKING",
    };
    const { data: ativo } = await db
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("provider", PROVIDER_META_SOCIAL)
      .eq("meta_social_account_id", c.contaId)
      .is("archived_at", null)
      .maybeSingle();
    let erro: { code?: string; message: string } | null = null;
    if (ativo) {
      ({ error: erro } = await db
        .from("channel_sessions")
        .update(campos)
        .eq("id", (ativo as { id: string }).id)
        .eq("organization_id", organizationId));
    } else {
      const segredo = await encryptWebhookSecret(db, randomBytes(32).toString("hex"));
      ({ error: erro } = await db.from("channel_sessions").insert({
        ...campos,
        organization_id: organizationId,
        provider: PROVIDER_META_SOCIAL,
        meta_social_account_id: c.contaId,
        webhook_secret_encrypted: segredo,
        metadata: { ...metadataInicialDoCanal(), social_platform: c.plataforma },
      }));
    }
    if (erro) {
      (erro.code === CONTA_JA_ATIVA ? r.emOutraEmpresa : r.falhas).push(c.nome);
      continue;
    }
    if (!paginasInscritas.has(c.paginaId)) {
      try {
        await graphSocial(
          c.tokenDaPagina,
          `${c.paginaId}/subscribed_apps`,
          { method: "POST", params: { subscribed_fields: CAMPOS_DA_PAGINA } },
          fetcher,
        );
        paginasInscritas.add(c.paginaId);
      } catch {
        r.falhas.push(c.nome);
        continue;
      }
    }
    r.conectadas.push(c.nome);
  }
  return r;
}

/** Arquiva o canal; tira a inscrição da página quando nenhum canal ativo a usa mais. */
export async function desconectarConta(
  db: SupabaseClient,
  organizationId: string,
  sessionId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const { data } = await db
    .from("channel_sessions")
    .select("id, meta_social_page_id, meta_social_account_id")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER_META_SOCIAL)
    .is("archived_at", null)
    .maybeSingle();
  const linha = data as { id: string; meta_social_page_id: string; meta_social_account_id: string } | null;
  if (!linha) return false;
  // O token é lido ANTES de arquivar: depois disso o canal não serve mais credencial.
  const cred = await credencialDaConta(db, organizationId, linha.meta_social_account_id);
  const { error } = await db
    .from("channel_sessions")
    .update({ archived_at: new Date().toISOString(), status: "STOPPED" })
    .eq("id", linha.id)
    .eq("organization_id", organizationId);
  if (error) return false;
  const { count } = await db
    .from("channel_sessions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("provider", PROVIDER_META_SOCIAL)
    .eq("meta_social_page_id", linha.meta_social_page_id)
    .is("archived_at", null);
  if (!count && cred) {
    await graphSocial(cred.token, `${linha.meta_social_page_id}/subscribed_apps`, { method: "DELETE" }, fetcher).catch(() => null);
  }
  return true;
}
