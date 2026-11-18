"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { escritaDeAdminOuRecusa } from "@/lib/auth/escritaDeAdminOuRecusa";
import { loadAuthUser } from "@/lib/auth/server";
import {
  CHAVE_VERSOES_OCULTAS,
  MAX_VERSOES_OCULTAS,
  chaveDaVersao,
  lerListaDeOcultas,
} from "@/lib/extensions/ocultas";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { gravarPelaTela, valorDaInstalacao } from "@/lib/instalacao/config";
import { createAdminClient } from "@/lib/supabase/admin";

export type OcultarVersaoResult = { ok: true } | { ok: false; error: string };

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(64);
const entradaSchema = z.strictObject({
  catalog_id: z.string().uuid(),
  publisher: slug,
  name: slug,
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/).max(64),
});

/**
 * Esconde UMA versão da aba Catálogo. Só quem administra a instalação, e nunca
 * a versão que está instalada — essa precisa continuar visível para trocar ou
 * desfazer.
 */
export async function ocultarVersaoDoCatalogo(input: unknown): Promise<OcultarVersaoResult> {
  const escrita = await escritaDeAdminOuRecusa();
  if (!escrita.ok) {
    return {
      ok: false,
      error:
        escrita.error === "mfa_required"
          ? "Confirme a verificação em duas etapas."
          : "Esta ação exige acesso completo à instalação.",
    };
  }
  const { user } = escrita.ctx;
  if ((await loadAuthUser())?.support) {
    return { ok: false, error: "Saia do acompanhamento administrativo antes de mudar o catálogo." };
  }
  const parsed = entradaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Versão do catálogo inválida." };
  const alvo = parsed.data;

  const { data: instalada, error } = await createAdminClient()
    .from("extension_installations")
    .select("id")
    .eq("catalog_id", alvo.catalog_id)
    .eq("publisher", alvo.publisher)
    .eq("name", alvo.name)
    .eq("version", alvo.version)
    .is("removed_at", null)
    .limit(1);
  if (error) return { ok: false, error: "Não foi possível conferir a instalação agora. Tente de novo." };
  if ((instalada ?? []).length > 0) {
    return { ok: false, error: "Esta versão está instalada. Troque de versão ou remova antes de excluí-la do catálogo." };
  }

  const atual = lerListaDeOcultas((await valorDaInstalacao(CHAVE_VERSOES_OCULTAS)).valor);
  const chave = chaveDaVersao(alvo.catalog_id, alvo);
  if (!atual.includes(chave)) {
    if (atual.length >= MAX_VERSOES_OCULTAS) return { ok: false, error: "Limite de versões ocultas atingido." };
    const gravado = await gravarPelaTela(CHAVE_VERSOES_OCULTAS, JSON.stringify([...atual, chave]), {
      ehSegredo: false,
      ator: user.id,
    });
    if (!gravado.ok) return { ok: false, error: "Não foi possível gravar no banco da instalação." };
  }

  const hdrs = await headers();
  await audit({
    action: "extension.catalog_entry_hidden",
    actorUserId: user.id,
    resourceType: "extension_catalog",
    resourceId: alvo.catalog_id,
    requestId: hdrs.get("x-request-id"),
    ip: ipDoCliente(hdrs),
    userAgent: hdrs.get("user-agent"),
    actingAsPlatformAdmin: true,
    metadata: { publisher: alvo.publisher, name: alvo.name, version: alvo.version },
  });
  return { ok: true };
}
