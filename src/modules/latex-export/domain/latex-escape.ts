/**
 * Tabla de escape de caracteres especiales de LaTeX.
 * =================================================
 *
 * Se aplica a TODO texto plano que sale de un doc TipTap y va a un .tex:
 *   • Texto de `<text>` nodes (enunciados, opciones, justificaciones).
 *   • Títulos de sección / evaluación.
 *   • Comentarios `% [...]` que el walker emite para nodos no manejados.
 *
 * NO se aplica a:
 *   • `attrs.tex` de inlineMath / blockMath — ya es LaTeX crudo de KaTeX
 *     upstream; escaparlo rompería la math (e.g. `\frac` → `\textbackslash frac`).
 *   • Atributos `src` / `width` de nodos `image` — son URLs y números, no
 *     texto renderizado.
 *
 * Cobertura: los 10 caracteres especiales canónicos de pandoc LaTeX writer.
 * Orden importa: el backslash (`\`) debe ir PRIMERO para no romper el
 * reemplazo de los demás (que introducen `\` en la salida).
 *
 * Referencia: https://pandoc.org/MANUAL.html#extension-latex_raw_tex
 */
// Usamos `\char92{}` (carácter ASCII 92 = `\`) en lugar de
// `\textbackslash{}` para evitar el ciclo de escape: el output de
// `\textbackslash{}` contiene `{}` que la siguiente regla (escape de `{`)
// re-escaparía a `\{\}`. `\char92{}` no contiene `{` ni `}` en el output,
// así que el resto de la tabla opera limpio.
// Referencia: TeX primitive `\char<num>` es portable y compila en todo
// LaTeX (article, beamer, etc.).
const ESCAPE_TABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\\/g, "\\char92{}"],
  [/([#$&_])/g, "\\$1"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"],
  [/[%]/g, "\\%"],
  [/>/g, "\\textgreater{}"],
  [/</g, "\\textless{}"],
  [/\r?\n/g, " "],
];

/**
 * Escapa el texto para uso dentro de un .tex (no en comentarios).
 *
 * Convierte newlines en espacios — los saltos de párrafo en TipTap los
 * emite el walker como `\par` o blank line, no como `\n` literal dentro del
 * texto. Si quieres preservar un newline dentro de un comentario, usa
 * `escapeLatexComment` en su lugar.
 */
export function escapeLatex(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ESCAPE_TABLE) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Escapa texto para embeber de forma segura dentro de un comentario LaTeX
 * (`% ...`). A diferencia de `escapeLatex`:
 *
 *   • NO escapa `<`, `>`, `~`, `^`, `%` — son inofensivos dentro de un `% ...`.
 *   • Sí escapa `{`, `}`, `\`, `#`, `$`, `&`, `_` — el primero por seguridad
 *     general; el resto porque aunque estén en un comentario, un parser
 *     LaTeX curioso podría interpretarlos si el comentario tiene continuación
 *     de línea incorrecta.
 *   • Convierte `\n` en continuación de comentario (`%\n% `) para que NO se
 *     "termine" el comentario a mitad del mensaje y el resto se interprete
 *     como LaTeX ejecutable.
 */
const COMMENT_ESCAPE_TABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\\/g, "\\char92{}"],
  [/([#$&_])/g, "\\$1"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/\r?\n/g, "\n% "],
];

export function escapeLatexComment(text: string): string {
  let out = text;
  for (const [pattern, replacement] of COMMENT_ESCAPE_TABLE) {
    out = out.replace(pattern, replacement);
  }
  return "% " + out;
}
