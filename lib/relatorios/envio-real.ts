/**
 * As dependências REAIS do envio agendado (o teste usa falsas, em `envio.ts`).
 * Roda com o client de service role, então TODA leitura filtra a organização à mão.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isServiceRoleConfigured } from "@/lib/audit";
import { marcaDaSaida } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/roteador";

import { coletarDadosDoPdf, type Nomeador } from "./coletar";
import { marcarEnvioDoRelatorio } from "./eco-do-envio";
import type { DepsDoEnvio } from "./envio";
import { gerarPdfDoRelatorio } from "./pdf";

/** Providers de número por QR: os únicos que mandam documento fora da janela de 24 h sem template. */
export const PROVIDERS_DO_ENVIO = ["evolution", "waha"] as const;

const VALIDADE_DO_LINK_S = 60 * 60;

export function nomeadorPeloAuth(admin: SupabaseClient): Nomeador {
  return async (ids) => {
    const mapa = new Map<string, string>();
    if (!isServiceRoleConfigured()) return mapa;
    await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        const u = data?.user;
        const nome = (u?.user_metadata?.full_name as string | undefined) ?? u?.email;
        if (nome) mapa.set(id, nome);
      }),
    );
    return mapa;
  };
}

export async function dadosDaEmpresa(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ empresa: string; tz: string | null; moeda: string; sistema: string }> {
  const [{ data: org }, marca] = await Promise.all([
    admin.from("organizations").select("display_name, legal_name, timezone, currency").eq("id", orgId).maybeSingle(),
    marcaDaSaida(orgId).catch(() => null),
  ]);
  const o = org as { display_name?: string | null; legal_name?: string | null; timezone?: string | null; currency?: string | null } | null;
  return {
    empresa: o?.display_name || o?.legal_name || "Empresa",
    tz: o?.timezone ?? null,
    moeda: o?.currency || "BRL",
    sistema: marca?.nome ?? "CRM",
  };
}

export function depsReais(
  admin: SupabaseClient,
  args: { orgId: string; tz: string; empresa: string; moeda: string; sistema: string; channelSessionId: string | null },
): DepsDoEnvio {
  return {
    async gerarPdf(periodo) {
      const dados = await coletarDadosDoPdf(
        admin,
        { orgId: args.orgId, tz: args.tz, from: new Date(periodo.from), to: new Date(periodo.to), de: periodo.de, ate: periodo.ate },
        nomeadorPeloAuth(admin),
      );
      return gerarPdfDoRelatorio(dados, { empresa: args.empresa, sistema: args.sistema, moeda: args.moeda });
    },

    async enviarEmail(e) {
      const r = await sendEmail({ ...e, fromName: args.sistema });
      return { ok: r.ok, error: r.error };
    },

    async publicarPdf(pdf, nomeDoArquivo) {
      // A marca vem ANTES do envio: o eco pode chegar antes da resposta HTTP.
      await marcarEnvioDoRelatorio(admin, args.orgId, nomeDoArquivo);
      const caminho = `${args.orgId}/${randomUUID()}-${nomeDoArquivo}`;
      const bucket = admin.storage.from("relatorios");
      const { error } = await bucket.upload(caminho, pdf, { contentType: "application/pdf", upsert: false });
      if (error) throw new Error(error.message);
      const { data, error: erroDoLink } = await bucket.createSignedUrl(caminho, VALIDADE_DO_LINK_S);
      if (erroDoLink || !data?.signedUrl) throw new Error(erroDoLink?.message ?? "link não gerado");
      return data.signedUrl;
    },

    async enviarWhatsapp(telefone, url, nomeDoArquivo, legenda) {
      if (!args.channelSessionId) throw new Error("nenhum número de WhatsApp escolhido para o envio");
      const { getAdapter, resolveSessionRef, CHANNEL_SESSION_REF_COLUMNS } = await import("@/lib/channels");
      const { data } = await admin
        .from("channel_sessions")
        .select(CHANNEL_SESSION_REF_COLUMNS)
        .eq("organization_id", args.orgId)
        .eq("id", args.channelSessionId)
        .maybeSingle();
      const linha = data as (Parameters<typeof resolveSessionRef>[0] & { provider: string }) | null;
      if (!linha) throw new Error("o número escolhido não existe mais");
      if (!(PROVIDERS_DO_ENVIO as readonly string[]).includes(linha.provider)) {
        throw new Error("escolha um número conectado por QR Code");
      }
      const adapter = getAdapter(linha.provider as never);
      if (!adapter.isConfigured()) throw new Error("o WhatsApp desta instalação não está configurado");
      const to = adapter.resolveRecipient({
        isGroup: false,
        groupChatId: null,
        phoneNumber: telefone,
        waIdentity: null,
        waLid: null,
      });
      if (!to) throw new Error("telefone inválido");
      await adapter.send({
        organizationId: args.orgId,
        sessionRef: resolveSessionRef(linha),
        to,
        kind: "document",
        media: { url, mime: "application/pdf", filename: nomeDoArquivo, caption: legenda },
      });
    },
  };
}
