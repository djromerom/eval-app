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
 *
 * Referencia: https://pandoc.org/MANUAL.html#extension-latex_raw_tex
 *
 * ## Implementación: single regex pass
 *
 * Una sola regex con todas las alternativas y un Map<match, replacement>.
 * Esto evita el bug clásico de "tabla de pares `[pattern, replacement]`":
 * el reemplazo de `\char92{}` introduce `{}` en el output, que la siguiente
 * regla de escape de `{`/`}` re-escaparía. Con un solo pass el `\` input
 * se mira UNA vez, no se vuelve a tocar.
 */

const ESCAPE_RE = /\\|[#$&_{}]|~|\^|%|>|<|\r\n|\r|\n/g;

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  "\\": "\\char92{}",
  "#": "\\#",
  $: "\\$",
  "&": "\\&",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "%": "\\%",
  "<": "\\textless{}",
  ">": "\\textgreater{}",
  "\r\n": " ",
  "\r": "",
  "\n": " ",
};

/**
 * Escapa el texto para uso dentro de un .tex (no en comentarios).
 *
 * Convierte newlines en espacios — los saltos de párrafo en TipTap los
 * emite el walker como `\par` o blank line, no como `\n` literal dentro del
 * texto. Si quieres preservar un newline dentro de un comentario, usa
 * `escapeLatexComment` en su lugar.
 */
export function escapeLatex(text: string): string {
  return text.replace(ESCAPE_RE, (m) => ESCAPE_MAP[m]!);
}

/**
 * Escapa texto para embeber de forma segura dentro de un comentario LaTeX
 * (`% ...`). A diferencia de `escapeLatex`:
 *
 *   • NO escapa `<`, `>`, `~`, `^`, `%` — son inofensivos dentro de un `% ...`.
 *   • Sí escapa `{`, `}`, `\`, `#`, `$`, `&`, `_` — por seguridad general,
 *     aunque estén en un comentario un parser LaTeX curioso podría
 *     interpretarlos si el comentario tiene continuación de línea incorrecta.
 *   • Convierte `\n` en continuación de comentario (`%\n% `) para que NO se
 *     "termine" el comentario a mitad del mensaje y el resto se interprete
 *     como LaTeX ejecutable.
 */
const COMMENT_ESCAPE_RE = /\\|[#$&_{}]|\r\n|\r|\n/g;
const COMMENT_ESCAPE_MAP: Readonly<Record<string, string>> = {
  "\\": "\\char92{}",
  "#": "\\#",
  $: "\\$",
  "&": "\\&",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "\r\n": "\n% ",
  "\r": "",
  "\n": "\n% ",
};

export function escapeLatexComment(text: string): string {
  const body = text.replace(COMMENT_ESCAPE_RE, (m) => COMMENT_ESCAPE_MAP[m]!);
  return "% " + body;
}
