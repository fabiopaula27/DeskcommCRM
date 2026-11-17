/**
 * Eco do envio em voo — regra compartilhada por WAHA e Evolution.
 *
 * O provedor pode entregar o `fromMe` do envio do próprio CRM ANTES de a
 * resposta HTTP do envio devolver o id: a linha nossa ainda está `sending` com
 * `external_id = null`, e o eco é indistinguível de alguém digitando no celular.
 * Lido como digitação, ele vira bolha duplicada `external_device` e cala a IA
 * por horas. Esta função responde "é eco nosso?" com prova forte.
 *
 * Extraída de `lib/waha/ingest.ts` sem mudança de comportamento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { semAssinatura } from "@/lib/messaging/assinatura";

/**
 * Quanto tempo um envio nosso pode ficar "em voo" antes de o eco deixar de ser
 * explicável por ele.
 *
 * 60s é folgado de propósito: o custo de errar para o lado permissivo é uma
 * digitação real do celular não silenciar a IA por um minuto; o custo de errar
 * para o outro lado é a IA muda por três horas. Os dois erros não são simétricos.
 */
export const JANELA_DO_ECO_MS = 60_000;

/**
 * A prova exigida é forte: uma linha nossa na MESMA conversa, ainda sem
 * `external_id` (portanto ainda em voo), com o MESMO corpo, dentro da janela.
 * Qualquer uma dessas faltando, a resposta é "não sei" — e "não sei" silencia,
 * porque é o desfecho seguro do lado do atendente humano (#371).
 *
 * Mídia não tem corpo comparável (o eco traz `media_url`, não texto): ali a
 * prova cai para "existe envio nosso em voo do mesmo tipo na janela", que é mais
 * permissivo e assumidamente mais fraco.
 */
export async function ehEcoDeEnvioEmVoo(
  // Aceita o admin tipado de qualquer canal.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  input: {
    organizationId: string;
    conversationId: string;
    corpo: string | null;
    ehMidia: boolean;
    /** Prefixo do log de erro (ex.: "waha.ingest"). */
    tag: string;
  },
): Promise<boolean> {
  const desde = new Date(Date.now() - JANELA_DO_ECO_MS).toISOString();
  const { data, error } = await admin
    .from("messages")
    .select("id, body, type")
    .eq("organization_id", input.organizationId)
    .eq("conversation_id", input.conversationId)
    .eq("direction", "outbound")
    // `sent_via` separa o que NASCEU aqui do que veio do celular: a linha do
    // celular é gravada como `external_device` e nunca pode servir de álibi.
    //
    // `automation` entrou junto do carimbo novo (#652). A mensagem que a REGRA
    // manda nasceu aqui tanto quanto a da IA e a do composer; sem ela nesta
    // lista, o eco do próprio envio da regra era lido como resposta pelo celular
    // e a IA ficava pausada na conversa por causa de uma mensagem que o CRM
    // mandou sozinho. Lista e carimbo andam juntos: quem escreve estes valores é
    // `origemDaMensagem`, em `app/api/v1/messages/_handler.ts`.
    //
    // `system` ENTRA pela mesma razão, e o sintoma seria idêntico: é o valor que
    // o envio por TOKEN DE SERVIDOR grava (#866). Fora desta lista, a linha da
    // integração deixa de ser reconhecida como envio NOSSO, o eco do próprio
    // envio vira "resposta pelo celular" e cala a IA por três horas.
    .in("sent_via", ["ai", "user", "automation", "system"])
    // Sem `external_id` = ainda não confirmada pelo canal = ainda em voo. É esta
    // a janela exata em que o eco é indistinguível de digitação humana.
    .is("external_id", null)
    .in("status", ["queued", "sending"])
    .gte("created_at", desde)
    .limit(20);

  if (error) {
    // Falha de leitura não pode virar "é eco": na dúvida, silencia — o
    // desfecho seguro é o do atendente humano.
    console.error(`[${input.tag}] checagem de eco falhou`, error.message);
    return false;
  }

  const corpo = (input.corpo ?? "").trim();
  for (const linha of data ?? []) {
    const l = linha as { body: string | null; type?: string | null };
    if (input.ehMidia) {
      // Mídia: sem corpo para comparar, a existência do envio em voo é a prova
      // possível. Mais fraco, e escrito para ninguém supor o contrário.
      // Texto é `chat` no WAHA e `text` na Evolution: nenhum dos dois é mídia.
      if (!["chat", "text"].includes(l.type ?? "chat")) return true;
      continue;
    }
    // Com a assinatura do emissor ligada (#2066), o eco traz `*Nome*\ntexto` e a
    // linha guarda `texto`: sem tirar a linha do nome, o eco do próprio envio
    // assinado seria lido como digitação no celular e calaria a IA.
    const gravado = (l.body ?? "").trim();
    if (corpo.length > 0 && (gravado === corpo || gravado === semAssinatura(corpo).trim())) return true;
  }
  return false;
}
