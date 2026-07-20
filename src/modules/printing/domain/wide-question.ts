/**
 * Decide si una pregunta debe ocupar el ancho completo de la página cuando el
 * cuadernillo se imprime a dos columnas.
 *
 * A dos columnas cada una mide ~8 cm en una carta. Un diagrama o una tabla ahí
 * quedan ilegibles, así que esas preguntas cruzan ambas columnas — es lo que
 * hace el examen de referencia de la institución.
 *
 * Función pura sobre el JSON de TipTap: no conoce ni la BD ni el DOM.
 */

/** Nodos de TipTap que no caben bien en media página. */
const WIDE_NODES = new Set(["image", "table"]);

/**
 * `true` si el contenido incluye algún nodo ancho (imagen o tabla) en
 * cualquier nivel de anidamiento.
 */
export function hasWideContent(content: unknown): boolean {
  if (Array.isArray(content)) return content.some(hasWideContent);
  if (!content || typeof content !== "object") return false;

  const node = content as { type?: unknown; content?: unknown };
  if (typeof node.type === "string" && WIDE_NODES.has(node.type)) return true;
  return hasWideContent(node.content);
}

/** Forma mínima que necesita `isWideQuestion` de una pregunta. */
export interface WideQuestionInput {
  text: unknown;
  image?: string | null;
  options: Array<{ text: unknown }>;
}

/**
 * `true` si la pregunta debe cruzar las dos columnas.
 *
 * Se mira el enunciado, las opciones y el campo `image` heredado (una pregunta
 * puede traer la imagen por ahí en vez de dentro del texto TipTap).
 */
export function isWideQuestion(question: WideQuestionInput): boolean {
  if (question.image) return true;
  if (hasWideContent(question.text)) return true;
  return question.options.some((o) => hasWideContent(o.text));
}
