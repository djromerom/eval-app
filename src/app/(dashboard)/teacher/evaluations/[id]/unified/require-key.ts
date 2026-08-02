/**
 * Validación de clave de respuesta para el formulario del editor unificado.
 *
 * Reglas:
 *  - Si hay < 2 opciones con texto → "Define al menos 2 opciones de respuesta."
 *  - Si la opción marcada como correcta está vacía → "FALTA DEFINIR LA CLAVE."
 *  - En cualquier otro caso → ok.
 *
 * El motivo de separar la validación de la presencia mínima (≥2) y de la
 * clave marcada (no vacía) es darle al docente mensajes accionables:
 * "necesitas más opciones" vs. "ya tienes opciones pero olvidaste la clave".
 */

export type RequireKeyResult = { ok: true } | { ok: false; msg: string };

export function requireKey(options: Record<string, string>, correctKey: string): RequireKeyResult {
  const filled = Object.values(options).filter((v) => (v ?? "").trim().length > 0);
  if (filled.length < 2) {
    return { ok: false, msg: "Define al menos 2 opciones de respuesta." };
  }
  const correctValue = (options[correctKey] ?? "").trim();
  if (correctValue.length === 0) {
    return { ok: false, msg: "FALTA DEFINIR LA CLAVE." };
  }
  return { ok: true };
}
