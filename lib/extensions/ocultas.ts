/**
 * Versões do catálogo que o dono da instalação escondeu da aba Catálogo.
 *
 * O catálogo admitido é um snapshot com digest e auditoria (`extension_catalogs`):
 * apagar uma entrada de dentro dele mudaria o que foi revisado. Esconder é só
 * vitrine — a lista mora em `platform_config` e a admissão continua intacta.
 * Uma versão instalada nunca é escondida (a ação recusa).
 */
import { valorDaInstalacao } from "@/lib/instalacao/config";

export const CHAVE_VERSOES_OCULTAS = "APP_EXTENSOES_OCULTAS";
export const MAX_VERSOES_OCULTAS = 500;

export function chaveDaVersao(
  catalogId: string,
  entry: { publisher: string; name: string; version: string },
): string {
  return `${catalogId}|${entry.publisher}|${entry.name}|${entry.version}`;
}

export function lerListaDeOcultas(bruto: string | null | undefined): string[] {
  if (!bruto) return [];
  try {
    const v: unknown = JSON.parse(bruto);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_VERSOES_OCULTAS) : [];
  } catch {
    return [];
  }
}

/** Falha aberta: sem conseguir ler, nada fica escondido (a vitrine mostra tudo, como antes). */
export async function versoesOcultas(): Promise<Set<string>> {
  try {
    return new Set(lerListaDeOcultas((await valorDaInstalacao(CHAVE_VERSOES_OCULTAS)).valor));
  } catch {
    return new Set();
  }
}
