/**
 * Credenciais do canal Evolution API (WhatsApp por QR/Baileys, auto-hospedado).
 *
 * O servidor é da INSTALAÇÃO (env), não da organização: cada empresa só ganha
 * uma instância nele. Qualquer das três variáveis vazia = canal indisponível.
 */
import { env } from "@/lib/env";

/** URL e apikey do servidor (sem a base de webhook); null se faltar algo. */
export function evolutionCredenciais(): { url: string; apiKey: string } | null {
  const url = (env.EVOLUTION_API_URL ?? "").trim();
  const apiKey = (env.EVOLUTION_API_KEY ?? "").trim();
  return url && apiKey ? { url, apiKey } : null;
}

export function evolutionConfigurado(): boolean {
  return [env.EVOLUTION_API_URL, env.EVOLUTION_API_KEY, env.EVOLUTION_WEBHOOK_BASE_URL].every(
    (v) => (v ?? "").trim() !== "",
  );
}
