/**
 * Generador del `main.tex` raíz del ZIP LaTeX (L5 — sep 2026).
 * ==============================================================
 *
 * Emite el preamble + `\input{eval-N.tex}` por cada evaluación del
 * cuadernillo. Es el ÚNICO archivo del ZIP que lleva `\documentclass`,
 * `\begin{document}`, etc. — los `eval-N.tex` son fragmentos que se
 * insertan vía `\input`.
 *
 * Paquetes incluidos (mínimos, suficientes para math, tablas, listas e
 * imágenes — todos standard en cualquier distro TeX/Overleaf):
 *   • inputenc{utf8}   → soporta ñ, tildes, ¿¡
 *   • fontenc{T1}      → hyphenation correcta en español
 *   • babel{spanish}   → "Capítulo" en vez de "Chapter", etc.
 *   • geometry         → márgenes 2.5cm (similar a carta)
 *   • graphicx         → \includegraphics
 *   • enumitem         → \setlist con labels custom
 *   • tabularx         → tablas auto-stretching
 *   • hyperref         → PDF bookmarks en Overleaf (último por best practice)
 *
 * Por qué NO usar `\include`: `\include` fuerza page break entre archivos,
 * indeseable para un cuadernillo continuo. `\input` es silencioso.
 */
import { escapeLatex } from "./latex-escape";

export interface MainTexInput {
  /** Título del cuadernillo (aparece en `\title{...}` y `\maketitle`). */
  bundleName: string;
  /** Nombres de los archivos `\input`-ables, en orden. Ej: `["eval-1.tex", "eval-2.tex"]`. */
  inputFiles: string[];
  /** Fecha legible para `\date{...}`. Si no se pasa, usa `\today`. */
  date?: string;
}

export function buildMainTex({ bundleName, inputFiles, date }: MainTexInput): string {
  const title = escapeLatex(bundleName);
  const dateLine = date ? escapeLatex(date) : "\\today";

  const inputs = inputFiles.map((f) => `\\input{${f}}`).join("\n");

  return `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[spanish]{babel}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{graphicx}
\\usepackage{enumitem}
\\usepackage{tabularx}
\\usepackage{hyperref}

\\setlist[enumerate]{label=\\textbf{\\arabic*.}, leftmargin=*}
\\setlist[itemize]{label=\\textbullet, leftmargin=*}

\\title{${title} \\texorpdfstring{--- LaTeX editable}{}}
\\author{Generado por Eval}
\\date{${dateLine}}

\\begin{document}
\\maketitle

${inputs}

\\end{document}
`;
}
