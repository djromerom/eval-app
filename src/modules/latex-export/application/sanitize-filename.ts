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

/**
 * Combinaciones de tildes y caracteres no-ASCII que `String.normalize("NFD")`
 * + strip de combining marks no maneja limpiamente. Se mantienen explícitas
 * para evitar sorpresas con `°`, `¿¡`, `—–` y similares.
 */
const ASCII_FALLBACKS: Record<string, string> = {
  "°": "",
  ñ: "n",
  Ñ: "n",
  á: "a",
  Á: "a",
  é: "e",
  É: "e",
  í: "i",
  Í: "i",
  ó: "o",
  Ó: "o",
  ú: "u",
  Ú: "u",
  ü: "u",
  Ü: "u",
  "¿": "",
  "¡": "",
  "—": "-",
  "–": "-",
};

/** Rango Unicode de los combining marks (Block "Combining Diacritical Marks"). */
const COMBINING_MARKS_RE = /[̀-ͯ]/g;

function asciiFold(s: string): string {
  // 1. Sustituciones explícitas (manejan chars que no se descomponen con
  //    NFD o cuyo fold no es trivial: °, ¿¡, em/en dash, etc.).
  let out = s;
  for (const [from, to] of Object.entries(ASCII_FALLBACKS)) {
    out = out.replaceAll(from, to);
  }
  // 2. NFD descompone tildes en `letra + combining-mark`. Strip los combining
  //    marks para que la letra base sobreviva (`Á` → `A` + U+0301 → `A`).
  out = out.normalize("NFD").replace(COMBINING_MARKS_RE, "");
  return out;
}

export function sanitizeFilename(input: string): string {
  if (!input) return "untitled";

  // 1. Fold de tildes (NFD + strip combining + sustituciones explícitas).
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
