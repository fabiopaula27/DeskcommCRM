/**
 * Quem transcreve um áudio desta organização FORA do worker de mídia — hoje,
 * as anotações do lead. Monta a mesma entrada da escada que o worker monta
 * (`workers/media-derive-worker.ts`, bloco "DE QUEM É O OUVIDO"): Scribe
 * escolhido no painel, serviço da instalação, chave OpenAI, modelo de conversa.
 * Nunca lança: sem transcritor, devolve `null` com o motivo.
 */
import type pg from "pg";

import { resolveOrgLlmConfig, type LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/credentials";
import { decidirTranscricao } from "@/lib/messaging/media/escada-de-transcricao";
import type { TranscriptionProvider } from "@/lib/messaging/media/transcription";

export type Transcritor = { transcriber: TranscriptionProvider | null; motivo: string };

type Binding = { provider: string; model_id: string; credential_id: string | null } | null;

export interface DepsDoTranscritor {
  resolver: typeof resolveOrgLlmConfig;
  decidir: typeof decidirTranscricao;
  lerBinding: (orgId: string, ponto: string) => Promise<Binding>;
  pool: () => pg.Pool;
}

export function llmCfgDoAmbiente(): LlmEdgeConfig {
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    cacheTtl: "1h",
  };
}

export async function transcritorDaOrganizacao(orgId: string, deps: DepsDoTranscritor): Promise<Transcritor> {
  const cfg = llmCfgDoAmbiente();
  try {
    let conversa: Awaited<ReturnType<typeof resolveOrgLlmConfig>> | null = null;
    try {
      conversa = await deps.resolver(deps.pool(), cfg, orgId);
    } catch {
      conversa = null;
    }
    const decisao = await deps.decidir({
      conversa: conversa
        ? { provider: conversa.provider, apiKey: conversa.apiKey, modelId: conversa.defaultModel }
        : null,
      chaveOpenai: async () => {
        if (conversa?.provider === "openai") return conversa.apiKey;
        try {
          return (await deps.resolver(deps.pool(), cfg, orgId, { provider: "openai" })).apiKey;
        } catch {
          return null;
        }
      },
      elevenlabsEscolhido: async () => {
        const binding = await deps.lerBinding(orgId, "transcricao_de_audio");
        if (binding?.provider !== "elevenlabs") return null;
        try {
          const el = await deps.resolver(deps.pool(), cfg, orgId, {
            provider: "elevenlabs",
            credentialId: binding.credential_id,
          });
          return { apiKey: el.apiKey, modelId: binding.model_id || "scribe_v1" };
        } catch {
          return null;
        }
      },
    });
    return { transcriber: decisao.transcriber ?? null, motivo: decisao.motivo };
  } catch (err) {
    return { transcriber: null, motivo: err instanceof Error ? err.message : String(err) };
  }
}

/** As dependências de verdade: pool do request, binding lido pelo admin. */
export async function depsReaisDoTranscritor(): Promise<DepsDoTranscritor> {
  const { getRequestPool } = await import("@/lib/agent-engine/db/request-pool");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  return {
    resolver: resolveOrgLlmConfig,
    decidir: decidirTranscricao,
    pool: getRequestPool,
    lerBinding: async (orgId, ponto) => {
      const { data, error } = await admin
        .from("ai_purpose_bindings")
        .select("provider, model_id, credential_id")
        .eq("organization_id", orgId)
        .eq("purpose", ponto)
        .eq("is_enabled", true)
        .maybeSingle();
      return error ? null : ((data as Binding) ?? null);
    },
  };
}
