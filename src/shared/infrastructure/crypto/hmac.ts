import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma HMAC-SHA256 de payloads (QR de hojas de respuesta).
 * El payload se serializa con claves ordenadas alfabéticamente para que
 * la firma sea determinista (ver REQUERIMIENTOS_v2.md §11).
 */
export function canonicalJson(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}

export function signPayload(payload: Record<string, unknown>, secret: string): string {
  return createHmac("sha256", secret).update(canonicalJson(payload)).digest("hex");
}

export function verifySignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): boolean {
  const expected = signPayload(payload, secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deriva la clave de firma por institución a partir de la clave maestra. */
export function deriveInstitutionSecret(masterSecret: string, institutionCode: string): string {
  return createHmac("sha256", masterSecret).update(`qr:${institutionCode}`).digest("hex");
}
