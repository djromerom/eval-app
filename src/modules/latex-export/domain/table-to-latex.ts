/**
 * Conversión de tabla TipTap → LaTeX tabularx (L4 — sep 2026).
 * =============================================================
 *
 * Reemplaza el stub temporal de L3. Maneja:
 *   • Spec de columnas: si todos los cells de la primera fila tienen
 *     `colwidth` uniforme, computamos ratios y emitimos `{0.3\linewidth}`
 *     etc. Si no hay widths o son inconsistentes, fallback a `XXXX`.
 *   • Header row: detectado por tipo `tableHeader` (no `tableCell`).
 *   • Empty cell: emite `~` (LaTeX idiom para celda no-vacía).
 *   • Cell walker: usa `renderInline` con `insideTableCell: true` para que
 *     `hardBreak` emita `\newline` (no `\\`, que es row terminator y rompe
 *     la tabla).
 *   • `\hline` repetido (no `booktabs`) — evita añadir `\usepackage`.
 *
 * NO usa `booktabs` para mantener el preamble de `main.tex` minimal.
 * Si en el futuro el docente quiere líneas más bonitas, se puede añadir
 * `\usepackage{booktabs}` + reemplazar `\hline` por `\toprule`/`\midrule`/
 * `\bottomrule` — cambio de 1 línea.
 */
import type { TipTapNode, WalkerContext } from "./latex-walker";
import { renderInline } from "./latex-walker";

// ---------------------------------------------------------------------------
// Column spec
// ---------------------------------------------------------------------------

/**
 * Devuelve el spec de columnas para tabularx. Si los widths son uniformes
 * (todos los cells de la primera fila tienen el mismo `colwidth`), usa
 * ratios explícitos. Si no, fallback a `XXXX` (4 cols `X` por defecto).
 *
 * `tabularx` con `X` auto-estira las columnas a `\linewidth`. El spec de
 * ratios fijos (`{0.3\linewidth}`) le da control fino al docente pero
 * requiere que todos los rows tengan widths consistentes.
 */
function buildColumnSpec(firstRow: TipTapNode | undefined, colCount: number): string {
  if (!firstRow) return "X".repeat(Math.max(colCount, 1));

  const cells = (firstRow.content ?? []).filter(isCellLike);
  if (cells.length !== colCount) return "X".repeat(Math.max(colCount, 1));

  // Extraer primer width de cada cell (colwidth[0] — colspan-aware).
  const widths = cells.map((c) => {
    const cw = c.attrs?.colwidth;
    if (Array.isArray(cw) && cw.length > 0 && typeof cw[0] === "number" && cw[0] > 0) {
      return cw[0];
    }
    return null;
  });

  // Si ningún cell tiene width → fallback.
  const anyWidth = widths.some((w) => w !== null);
  if (!anyWidth) return "X".repeat(Math.max(colCount, 1));

  // Si TODOS los cells tienen el MISMO width, emitimos ratios iguales.
  // Si son DIFERENTES, emitimos ratios proporcionales.
  const numericWidths = widths.map((w) => w ?? 1);
  const total = numericWidths.reduce((a, b) => a + b, 0);
  if (total === 0) return "X".repeat(Math.max(colCount, 1));

  // Ratio < 0.15 hace la columna muy estrecha; caemos a `X` simple para
  // que LaTeX tenga flexibilidad.
  return numericWidths
    .map((w) => {
      const ratio = w / total;
      if (ratio < 0.15) return "X";
      // Multiplicador de \linewidth, 2 decimales.
      return `{${ratio.toFixed(2)}\\linewidth}`;
    })
    .join("");
}

function isCellLike(n: TipTapNode): boolean {
  return n.type === "tableCell" || n.type === "tableHeader";
}

// ---------------------------------------------------------------------------
// Cell rendering
// ---------------------------------------------------------------------------

function renderCell(node: TipTapNode, ctx: WalkerContext): string {
  const inner = (node.content ?? []).map((c) => {
    // Cells suelen contener un `paragraph` como primer hijo; lo
    // "desenvolvemos" para no inflar con `\par` extra (entre cells los
    // saltos son `\\`, no `\par`).
    if (c.type === "paragraph") {
      return (c.content ?? []).map((cc) => renderInline(cc, ctx)).join("");
    }
    // Otros nodos (listas, tablas anidadas) se renderizan como bloque
    // dentro de la celda.
    return renderInline(c, ctx);
  });
  const text = inner.join("\n").trim();
  return text.length > 0 ? text : "~";
}

function isHeaderRow(row: TipTapNode): boolean {
  return (row.content ?? []).some((c) => c.type === "tableHeader");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Renderiza un `table` TipTap como entorno `tabularx` LaTeX. El caller
 * (latex-walker) ya maneja el wrap a nivel de bloque — esta función solo
 * produce el cuerpo del `tabularx` con sus filas.
 *
 * Si la tabla está vacía (sin rows), devuelve cadena vacía (no emite
 * entorno LaTeX).
 */
export function tiptapTableToLatex(node: TipTapNode, ctx: WalkerContext): string {
  const rows = (node.content ?? []).filter((c) => c.type === "tableRow");
  if (rows.length === 0) return "";

  // Asumimos que todas las filas tienen el mismo número de cells (prosemirror
  // lo garantiza). Si no, usamos el máximo.
  const colCount = Math.max(...rows.map((r) => (r.content ?? []).filter(isCellLike).length), 1);

  const firstRow = rows[0];
  const colSpec = buildColumnSpec(firstRow, colCount);

  // Marcamos `insideTableCell: true` para que `hardBreak` emita `\newline`.
  const cellCtx: WalkerContext = { ...ctx, insideTableCell: true };

  const body = rows
    .map((row) => {
      const cells = (row.content ?? []).filter(isCellLike);
      const rendered = cells.map((c) => renderCell(c, cellCtx));
      // Pad con celdas vacías si la fila tiene menos cells que colCount.
      while (rendered.length < colCount) rendered.push("~");
      const isHeader = isHeaderRow(row);
      const cellsTex = isHeader ? rendered.map((c) => `\\textbf{${c}}`) : rendered;
      return `${cellsTex.join(" & ")} \\\\`;
    })
    .join("\n\\hline\n");

  // tabularx con width `\linewidth` auto-estira las `X` columns. `\hline`
  // repetido funciona sin paquetes extra.
  return [
    `\\begin{tabularx}{\\linewidth}{${colSpec}}`,
    `\\hline`,
    body,
    `\\hline`,
    `\\end{tabularx}`,
  ].join("\n");
}
