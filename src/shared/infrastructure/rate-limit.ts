import type IORedis from "ioredis";
import { logger } from "@/shared/infrastructure/logger";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSec: number;
}

/**
 * Sliding-window aproximado por contador: `INCR` por key, `EXPIRE` solo
 * en la primera marca del bucket. Atómico para nuestro caso (toleramos
 * el race de INCR/EXPIRE separados — al peor caso, una ventana queda 1s
 * más larga). Si la app crece a requerir precisión exacta, migrar a
 * script Lua.
 *
 * **Fail-open**: si Redis lanza una excepción, logueamos y devolvemos
 * `allowed: true`. Decisión deliberada (ago 2026): preferimos
 * disponibilidad ante una caída de Redis a bloquear el flujo. Un
 * atacante con Redis caído puede bypasear el rate limit durante la
 * ventana de outage; aceptable para endpoints públicos donde el peor
 * caso es que le manden un email adicional.
 *
 * @param redis Cliente ioredis.
 * @param key Clave lógica del bucket (se prefija con `ratelimit:`).
 * @param limit Cantidad máxima de requests permitidos en la ventana.
 * @param windowMs Duración de la ventana en milisegundos.
 */
export async function checkRateLimit(
  redis: IORedis,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const fullKey = `ratelimit:${key}`;
  try {
    const count = await redis.incr(fullKey);
    if (count === 1) {
      await redis.pexpire(fullKey, windowMs);
    }
    const ttl = await redis.pttl(fullKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetInSec: Math.max(0, Math.ceil(ttl / 1000)),
    };
  } catch (err) {
    logger.error({ err, key }, "rate limit falló (fail-open)");
    return { allowed: true, remaining: limit, resetInSec: 0 };
  }
}
