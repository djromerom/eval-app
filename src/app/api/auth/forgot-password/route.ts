import { NextResponse } from "next/server";
import { z } from "zod";
import { getRedisConnection } from "@/shared/infrastructure/queue/queues";
import { checkRateLimit } from "@/shared/infrastructure/rate-limit";
import { makeRequestPasswordReset } from "@/modules/recovery/infrastructure/container";

export const runtime = "nodejs";

const bodySchema = z.object({ email: z.string().email() });

const WINDOW_MS = 60 * 60 * 1000; // 1h
const IP_LIMIT = 10;
const EMAIL_LIMIT = 5;

/**
 * POST /api/auth/forgot-password
 *
 * Anti-enumeración: la respuesta es SIEMPRE 200 con `{ ok: true }`,
 * exista o no el usuario, el email sea válido o no, o el rate limit
 * esté excedido. Esto cierra el side-channel de "sé si ese email
 * está registrado en la plataforma".
 *
 * Rate limit: 10/h por IP, 5/h por email. Si Redis falla, fail-open
 * (ver `checkRateLimit`). El endpoint sigue respondiendo.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    // 200 igual: body mal formado se trata como "email inválido".
    return NextResponse.json({ ok: true });
  }

  const redis = getRedisConnection();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  // Rate limit por IP.
  const ipLimit = await checkRateLimit(redis, `pwreset:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!ipLimit.allowed) {
    return NextResponse.json({ ok: true });
  }

  // Rate limit por email.
  const emailLimit = await checkRateLimit(
    redis,
    `pwreset:email:${parsed.data.email.toLowerCase()}`,
    EMAIL_LIMIT,
    WINDOW_MS,
  );
  if (!emailLimit.allowed) {
    return NextResponse.json({ ok: true });
  }

  await makeRequestPasswordReset().execute({ email: parsed.data.email });
  return NextResponse.json({ ok: true });
}
