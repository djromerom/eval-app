import { generateHTML } from "@tiptap/html";
import katex from "katex";
import { richTextExtensions } from "./extensions";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false });
  } catch {
    const d = displayMode ? "$$" : "$";
    return `${d}${escapeHtml(tex)}${d}`;
  }
}

/**
 * Reemplaza fórmulas `$$...$$` (bloque) y `$...$` (inline) por KaTeX.
 * Solo dentro de un mismo segmento de texto (sin `<`/`>`), para no cruzar
 * etiquetas HTML del contenido enriquecido.
 */
function applyKatex(html: string): string {
  return html
    .replace(/\$\$([^$<>]+?)\$\$/g, (_m, tex: string) => renderTex(tex, true))
    .replace(/\$([^$<>\n]+?)\$/g, (_m, tex: string) => renderTex(tex, false));
}

/**
 * Renderiza contenido rico a HTML seguro para `dangerouslySetInnerHTML`.
 * Acepta el documento JSON de TipTap o un string plano (contenido heredado).
 * Server-safe (usa @tiptap/html + KaTeX, sin DOM del navegador).
 */
export function renderRichText(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "string") {
    if (!value.trim()) return "";
    return applyKatex(escapeHtml(value)).replace(/\n/g, "<br/>");
  }

  if (typeof value === "object" && (value as { type?: string }).type === "doc") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return applyKatex(generateHTML(value as any, richTextExtensions));
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Quita el `<p>` exterior cuando el contenido es un ÚNICO párrafo.
 *
 * TipTap siempre envuelve el texto en `<p>`. En los sitios donde el contenido
 * va en línea con algo más — "319. ¿Qué inicia…", "A. Memoria repetitiva" —
 * ese bloque forzaba un salto de línea (el número quedaba solo en su renglón)
 * y además generaba HTML inválido: un `<p>` anidado dentro del `<p>` de
 * `.question-text`.
 *
 * Si hay varios párrafos se devuelve el HTML intacto: desenvolverlos juntaría
 * los textos y dejaría un `</p><p>` suelto a mitad del marcado.
 */
export function unwrapSingleParagraph(html: string): string {
  const match = /^<p(?:\s[^>]*)?>([\s\S]*)<\/p>$/.exec(html.trim());
  if (!match) return html;
  const inner = match[1] ?? "";
  // Un cierre de párrafo por dentro delata que eran dos o más.
  if (inner.includes("</p>")) return html;
  return inner;
}

/** Extrae texto plano (para búsquedas, resúmenes, títulos cortos). */
export function richTextToPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const walk = (node: { text?: string; content?: unknown[] }): string => {
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map((c) => walk(c as never)).join(" ");
      return "";
    };
    return walk(value as never).trim();
  }
  return "";
}
