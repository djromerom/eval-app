/**
 * Walker recursivo TipTap → LaTeX (L3 — sep 2026).
 * =================================================
 *
 * Función PURA: cero I/O, cero dependencias externas (ni KaTeX ni
 * almacenamiento). Toma un doc TipTap (`unknown` por seguridad) y devuelve
 * un string LaTeX. El caller (use case `BuildLatexZip`) pasa un
 * `imageResolver` callback que decide qué hacer con cada `<image>` node
 * (inline binario al ZIP vs. skip con comentario).
 *
 * Reglas clave (ver plan en `.claude/plans/rippling-toasting-giraffe.md`):
 *   • Top-level: párrafos separados por `\par\n\n`. Headings como
 *     `\section*{…}` / `\subsection*{…}` / `\subsubsection*{…}`.
 *   • Inline: text, marks (bold/italic/code), inlineMath (`$tex$`),
 *     hardBreak (`\\`).
 *   • Block: blockMath (`\[tex\]`), listas, tablas.
 *   • Nodos desconocidos: `% [UNHANDLED node: <type>]` + JSON crudo
 *     embebido como comentario — NUNCA throw, para que un .tex con un
 *     nodo raro siga siendo compilable.
 *
 * NO se escapa el `tex` de los nodos math — ya es LaTeX crudo de KaTeX
 * upstream (PR #17). Aplicarle el escape lo rompería (`\frac` →
 * `\char92 frac`).
 */
import { escapeLatex, escapeLatexComment } from "./latex-escape";

// ---------------------------------------------------------------------------
// Tipos del walker
// ---------------------------------------------------------------------------

/** Nodo TipTap genérico (no usamos la clase `ProseMirrorNode` para mantener
 *  el walker 100% puro y testeable sin inicializar un editor). Exportado
 *  para que módulos hermanos (`table-to-latex.ts`) puedan compartir el
 *  shape sin redefinir tipos. */
export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export type ImageResolution =
  { kind: "inline"; filename: string } | { kind: "skip"; reason: "external" | "data" | "unknown" };

export interface ImageRef {
  /** Path relativo al storage local (lo lee `localStorage.read()` el use case). */
  storagePath: string;
  /** Filename dentro de `images/` en el ZIP. */
  zipFilename: string;
  /** MIME type para logs/debug. */
  mime: string;
}

export interface WalkerContext {
  /** Coletector de imágenes a copiar al ZIP. El walker solo agrega; el use
   *  case los lee y los escribe. */
  images: ImageRef[];
  /** Resolver de `<image>` nodes: "qué hago con este src". Inyectado por el
   *  use case para no acoplar el walker a filesystem/storage. */
  resolveImage: (src: string) => ImageResolution;
  /** Si estamos dentro de una celda tabularx: `hardBreak` debe emitir
   *  `\newline` (no `\\`, que es row terminator y rompe la tabla). */
  insideTableCell: boolean;
  /** Profundidad (para evitar ciclos si un doc tiene auto-referencias). */
  depth: number;
}

const MAX_DEPTH = 100;

// ---------------------------------------------------------------------------
// Walker entrypoint
// ---------------------------------------------------------------------------

/** Convierte un doc TipTap en un string LaTeX. Si el doc está vacío o solo
 *  tiene nodos sin renderizable, devuelve `""`. */
export function tiptapToLatex(doc: unknown, ctx: WalkerContext): string {
  if (!doc || typeof doc !== "object") return "";
  const root = doc as TipTapNode;
  if (root.type !== "doc" || !Array.isArray(root.content)) return "";

  const blocks = root.content.map((n) => renderBlock(n, ctx));
  // Filtramos bloques vacíos para no acumular `\par\n\n` redundantes.
  const nonEmpty = blocks.filter((b) => b.trim().length > 0);
  return nonEmpty.join("\n\n");
}

// ---------------------------------------------------------------------------
// Block-level dispatch
// ---------------------------------------------------------------------------

function renderBlock(node: TipTapNode, ctx: WalkerContext): string {
  if (ctx.depth > MAX_DEPTH) return "";
  const childCtx = { ...ctx, depth: ctx.depth + 1 };

  switch (node.type) {
    case "paragraph":
      return renderParagraph(node, childCtx);
    case "heading":
      return renderHeading(node, childCtx);
    case "blockMath":
      return renderBlockMath(node);
    case "bulletList":
      return renderList(node, childCtx, "itemize");
    case "orderedList":
      return renderList(node, childCtx, "enumerate");
    case "table":
      // La tabla se delega a `table-to-latex.ts` (L4) para mantener este
      // archivo corto. Import cíclico evitado: lo hacemos lazy aquí.
      return renderTable(node, childCtx);
    case "image":
      // Imagen a nivel de bloque (sin párrafo padre). LaTeX no permite
      // `\includegraphics` flotando fuera de un párrafo, pero como el
      // caller lo emite entre `\par\n\n`, funciona.
      return renderImageBlock(node, ctx);
    default:
      return unhandledBlock(node);
  }
}

function renderParagraph(node: TipTapNode, ctx: WalkerContext): string {
  const inline = (node.content ?? []).map((c) => renderInline(c, ctx)).join("");
  // Si el párrafo está vacío (TipTap lo inicializa así), devolvemos cadena
  // vacía para no inflar el output con párrafos fantasma.
  if (inline.trim().length === 0) return "";

  // `textAlign` aplicado al párrafo.
  const align = node.attrs?.align;
  if (align === "center") return `\\begin{center}\n${inline}\n\\end{center}`;
  if (align === "right") return `\\begin{flushright}\n${inline}\n\\end{flushright}`;
  return inline;
}

function renderHeading(node: TipTapNode, ctx: WalkerContext): string {
  const level = Number(node.attrs?.level ?? 2);
  const cmd = level === 1 ? "section" : level === 2 ? "subsection" : "subsubsection";
  const inline = (node.content ?? []).map((c) => renderInline(c, ctx)).join("");
  if (inline.trim().length === 0) return "";
  return `\\${cmd}*{${inline}}`;
}

function renderBlockMath(node: TipTapNode): string {
  const tex = String(node.attrs?.tex ?? "");
  // Wrap con blank lines para que LaTeX lo parsee como display math.
  return `\\[${tex}\\]`;
}

function renderList(node: TipTapNode, ctx: WalkerContext, env: "itemize" | "enumerate"): string {
  const items = (node.content ?? []).filter((c) => c.type === "listItem");
  if (items.length === 0) return "";

  const startAttr = env === "enumerate" ? node.attrs?.start : undefined;
  const startOpts =
    env === "enumerate" && typeof startAttr === "number" && startAttr > 1
      ? `[start=${startAttr}]`
      : "";

  const body = items
    .map((item) => {
      const inner = (item.content ?? []).map((c) => {
        // Los items suelen contener un `paragraph` como primer hijo; lo
        // "desenvolvemos" para evitar `\par` extra dentro de `\item`.
        if (c.type === "paragraph") {
          return (c.content ?? []).map((cc) => renderInline(cc, ctx)).join("");
        }
        // Otros nodos (listas anidadas) se renderizan como bloque.
        return renderBlock(c, ctx);
      });
      const innerText = inner.filter((s) => s.length > 0).join("\n");
      return innerText.length > 0 ? `  \\item ${innerText}` : "";
    })
    .filter((s) => s.length > 0);

  if (body.length === 0) return "";
  return `\\begin{${env}}${startOpts}\n${body.join("\n")}\n\\end{${env}}`;
}

function renderImageBlock(node: TipTapNode, ctx: WalkerContext): string {
  return renderImageCore(node, ctx);
}

// ---------------------------------------------------------------------------
// Inline-level dispatch
// ---------------------------------------------------------------------------

export function renderInline(node: TipTapNode, ctx: WalkerContext): string {
  if (ctx.depth > MAX_DEPTH) return "";

  // Text node: aplicamos marks (bold/italic/code) wrap-around + escape.
  if (node.type === "text") {
    return renderTextNode(node, ctx);
  }

  switch (node.type) {
    case "inlineMath":
      return renderInlineMath(node);
    case "hardBreak":
      // Dentro de celda tabularx, `\\` rompe la fila — usamos `\newline`.
      return ctx.insideTableCell ? "\\newline" : "\\\\";
    case "image":
      return renderImageCore(node, ctx);
    case "bulletList":
    case "orderedList":
    case "table":
      // Bloques appearing inline: los envolvemos y dejamos que el block
      // dispatcher los formatee. No deberían ocurrir, pero defensive.
      return renderBlock(node, ctx);
    default:
      // Nodos inline desconocidos: probamos a renderizar su content como
      // text y si están vacíos emitimos comentario.
      if (Array.isArray(node.content) && node.content.length > 0) {
        return node.content.map((c) => renderInline(c, ctx)).join("");
      }
      return unhandledInline(node);
  }
}

function renderTextNode(node: TipTapNode, ctx: WalkerContext): string {
  const raw = typeof node.text === "string" ? node.text : "";
  const escaped = escapeLatex(raw);
  const marks = node.marks ?? [];

  // Aplicamos marks de fuera hacia adentro (orden inverso al cierre):
  // `bold` + `italic` → `\textbf{\textit{...}}`.
  let out = escaped;
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (!m) continue;
    switch (m.type) {
      case "bold":
        out = `\\textbf{${out}}`;
        break;
      case "italic":
        out = `\\textit{${out}}`;
        break;
      case "code":
        out = `\\texttt{${out}}`;
        break;
      case "underline":
        out = `\\underline{${out}}`;
        break;
      case "strike":
        out = `\\sout{${out}}`;
        break;
      // Marks desconocidos: los ignoramos (no throw) — el texto base ya
      // está escapado.
    }
  }
  return out;
}

function renderInlineMath(node: TipTapNode): string {
  const tex = String(node.attrs?.tex ?? "");
  // IMPORTANTE: NO escapar `tex` — ya es LaTeX crudo de KaTeX upstream.
  return `$${tex}$`;
}

// ---------------------------------------------------------------------------
// Image handling
// ---------------------------------------------------------------------------

function renderImageCore(node: TipTapNode, ctx: WalkerContext): string {
  const src = String(node.attrs?.src ?? "");
  if (!src) return "% [imagen sin src]";

  const resolution = ctx.resolveImage(src);

  if (resolution.kind === "skip") {
    const reason =
      resolution.reason === "external"
        ? "externa omitida"
        : resolution.reason === "data"
          ? "data: omitida por portabilidad"
          : "origen no resuelto";
    return `% [imagen ${reason}: ${src}]`;
  }

  // Resolución inline: emitimos `\includegraphics` con width = % de columna
  // → multiplicador de `\linewidth`.
  const widthAttr = node.attrs?.width;
  const widthPct = typeof widthAttr === "number" && Number.isFinite(widthAttr) ? widthAttr : 60; // default 60% si no viene (consistente con ResizableImage default)
  const widthTex = (widthPct / 100).toFixed(2).replace(/\.?0+$/, "") || "1";
  // ↑ toFixed(2) → "0.60" → replace trailing zeros → "0.6". Edge case:
  // si widthPct es 100, queda "1" (sin punto), que es válido.

  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  const altSuffix = alt ? `,${escapeLatex(alt)}` : "";

  return `\\includegraphics[width=${widthTex}\\linewidth${altSuffix}]{images/${resolution.filename}}`;
}

// ---------------------------------------------------------------------------
// Table handling — delegación lazy a L4
// ---------------------------------------------------------------------------

import { tiptapTableToLatex } from "./table-to-latex";

function renderTable(node: TipTapNode, ctx: WalkerContext): string {
  return tiptapTableToLatex(node, ctx);
}

// ---------------------------------------------------------------------------
// Fallback defensivo para nodos no manejados
// ---------------------------------------------------------------------------

function unhandledBlock(node: TipTapNode): string {
  return escapeLatexComment(`UNHANDLED block node: ${node.type}`);
}

function unhandledInline(node: TipTapNode): string {
  return escapeLatexComment(`UNHANDLED inline node: ${node.type}`);
}
