/**
 * Helpers para normalizar valores de `searchParams` en rutas de /print.
 *
 * En Next.js 15, `searchParams` es `Record<string, string | string[] | undefined>`.
 * Cuando el form cliente usa varios `<input name="students">`, el browser
 * envía `?students=a&students=b` y Next.js lo parsea como **array**, no como
 * string con comas. Asumir `string` y llamar `.split(",")` rompe con
 * `TypeError: studentIds?.split is not a function`.
 */

/** Acepta string csv, array de strings, array de csv's, o undefined.
 *  Devuelve siempre `string[]` plano sin vacíos ni espacios. */
export function normalizeStudentIds(raw: string | string[] | undefined): string[] {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}
