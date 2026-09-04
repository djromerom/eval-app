/**
 * Slug de filenames para el ZIP LaTeX (L7 — sep 2026).
 * ====================================================
 *
 * Convierte un string arbitrario (ej. título de evaluación) en un nombre
 * de archivo seguro para Overleaf:
 *   • Solo ASCII (letras, dígitos, `-`, `_`, `.`).
 *   • Sin caracteres reservados de filesystem (`/\:*?"<>|`).
 *   • Sin espacios (reemplazados por `-`).
 *   • Trim de guiones al inicio/fin.
 *   • Lowercase.
 *   • Si queda vacío, devuelve `"untitled"`.
 *   • Cap a 80 chars para mantener paths razonables.
 *
 * Por qué ASCII-only: Overleaf maneja UTF-8 en el editor, pero los
 * nombres de archivo en el ZIP/archive layer son más quisquillosos. Si
 * el docente subió un título con `ñ` o tildes, el slug lo limpia para
 * portabilidad cross-platform.
 *
 * Caso de uso:
 *   sanitizeFilename("Matemáticas 10° - Periodo I")
 *   → "matematicas-10-periodo-i"
 */

const MAX_LENGTH = 80;
const RESERVED_RE = /[\\/:*?"<>|\s]+/g;
const NON_ASCII_RE = /[^\x20-\x7E]/g;
const TRIM_RE = /^[-_.]+|[-_.]+$/g;

const ASCII_FALLBACKS: Record<string, string> = {
  "°": "",
  ñ: "n",
  á: "a",
  é: "e",
  í: "i",
  ó: "o",
  ú: "u",
  ü: "u",
  "¿": "",
  "¡": "",
  "—": "-",
  "–": "-",
};

function asciiFold(s: string): string {
  let out = s;
  for (const [from, to] of Object.entries(ASCII_FALLBACKS)) {
    out = out.replaceAll(from, to);
  }
  return out;
}

export function sanitizeFilename(input: string): string {
  if (!input) return "untitled";

  // 1. Fold de tildes y chars no-ASCII comunes.
  let s = asciiFold(input);

  // 2. Strip todo lo que no sea ASCII imprimible.
  s = s.replace(NON_ASCII_RE, "");

  // 3. Reemplaza reserved chars + whitespace por `-`.
  s = s.replace(RESERVED_RE, "-");

  // 4. Colapsa múltiples guiones.
  s = s.replace(/-+/g, "-");

  // 5. Trim de `-`, `_`, `.` al inicio/fin.
  s = s.replace(TRIM_RE, "");

  // 6. Lowercase.
  s = s.toLowerCase();

  // 7. Cap.
  if (s.length > MAX_LENGTH) {
    s = s.slice(0, MAX_LENGTH).replace(TRIM_RE, "");
  }

  return s.length > 0 ? s : "untitled";
}
