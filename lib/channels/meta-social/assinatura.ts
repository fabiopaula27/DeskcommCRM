/**
 * A entrega veio mesmo da Meta? `X-Hub-Signature-256: sha256=<hmac do corpo
 * cru com o App Secret>`. Comparação em tempo constante.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function assinaturaValida(corpoBruto: string, cabecalho: string | null, appSecret: string): boolean {
  if (!cabecalho || !appSecret || !cabecalho.startsWith("sha256=")) return false;
  const recebida = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  const esperada = createHmac("sha256", appSecret).update(corpoBruto, "utf8").digest();
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}
