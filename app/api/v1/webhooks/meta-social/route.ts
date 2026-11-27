/**
 * Webhook do app da Meta para Messenger e Instagram Direct (conexão direta).
 *
 * GET  — handshake: `hub.verify_token` igual ao verify token do app da instalação.
 * POST — assinatura `X-Hub-Signature-256` com o App Secret; inválida → 401.
 *        Depois, sempre 200: evento sem canal ou que falhou fica no log, e a
 *        Meta não reentrega para sempre um corpo que não vai melhorar.
 * A organização vem do CANAL da conta (`entry.id`), nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { appDaMeta } from "@/lib/channels/meta/app";
import { verificationChallenge } from "@/lib/channels/meta/webhook";
import { assinaturaValida } from "@/lib/channels/meta-social/assinatura";
import { processarEntrega } from "@/lib/channels/meta-social/entrega";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { verifyToken } = await appDaMeta();
  const challenge = verificationChallenge(req.nextUrl.searchParams, verifyToken ?? "");
  if (challenge === null) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const corpo = await req.text();
  const { appSecret } = await appDaMeta();
  if (!assinaturaValida(corpo, req.headers.get("x-hub-signature-256"), appSecret ?? "")) {
    return fail("unauthorized", "invalid_signature", 401, { requestId });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return fail("invalid_request", "invalid_json", 400, { requestId });
  }
  const r = await processarEntrega(createAdminClient(), payload);
  if (r.falhas > 0 || r.ignorados > 0) logger.info("[meta-social] entrega", { request_id: requestId, ...r });
  return NextResponse.json({ ok: true }, { status: 200 });
}
