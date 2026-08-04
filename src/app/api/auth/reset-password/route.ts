import { NextResponse } from "next/server";
import { z } from "zod";
import { getRedisConnection } from "@/shared/infrastructure/queue/queues";
import { checkRateLimit } from "@/shared/infrastructure/rate-limit";
import { makeResetPassword } from "@/modules/recovery/infrastructure/container";

export const runtime = "nodejs";

const bodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
  passwordConfirm: z.string().min(6),
});

const WINDOW_MS = 60 * 60 * 1000; // 1h
const IP_LIMIT = 10;

/**
 * POST /api/auth/reset-password
 *
 * Aplica la nueva contraseña a partir de un token previamente emitido
 * por /api/auth/forgot-password. A diferencia de ese endpoint, este
 * SÍ devuelve errores específicos (422) cuando el token es inválido
 * o expiró, porque el usuario tiene el link en mano y necesita saber
 * por qué falla.
 *
 * Rate limit: 10/h por IP (separado del de solicitud porque el path
 * es distinto: uno recibe un link, el otro puede ser forzado por
 * script probando tokens).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Datos inválidos." } },
      { status: 422 },
    );
  }

  const redis = getRedisConnection();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await checkRateLimit(redis, `pwreset:apply:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Demasiados intentos. Intenta más tarde.",
        },
      },
      { status: 429 },
    );
  }

  const result = await makeResetPassword().execute({
    rawToken: parsed.data.token,
    password: parsed.data.password,
    passwordConfirm: parsed.data.passwordConfirm,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.error.code, message: result.error.message } },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true });
}
