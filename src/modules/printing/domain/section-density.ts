/**
 * Decide si una sección del cuadernillo impreso se renderiza a **una columna**
 * (densidad "high", default histórico) o a **dos columnas** (densidad "low",
 * para ítems cortos que desperdiciarían media página en cada uno).
 *
 * Caso de uso típico: matching A–H, completar, V/F — preguntas de 1 línea
 * con varias opciones cortas. Cada ítem ocupa ~10 líneas, así que en una
 * columna entran 3-4 por página; en dos columnas entran 8-10.
 *
 * Función pura sobre `EvaluationSection`. Sin estado, sin DOM, sin BD.
 * Vive en `printing/domain` porque es decisión de layout, no de negocio.
 *
 * El docente puede sobreescribir la decisión por sección desde el editor
 * (Commit 2 del sprint). Mientras tanto, esta heurística marca el default.
 */

import type { EvaluationSection } from "@/modules/evaluations/domain/evaluation";

/** "low" → la sección se imprime a 2 columnas. "high" → a 1 columna. */
export type SectionDensity = "low" | "high";

/**
 * Umbral en caracteres promedio por ítem (texto del enunciado + opciones).
 *
 * - Matching A–H real (INGLÉS PARTE 1): ~75 chars/ítem → "low".
 * - Pregunta típica con 4 opciones: ~30-60 chars → "low".
 * - Pregunta con párrafo largo + opciones: >150 chars → "high".
 * - Pregunta con imagen: "high" por la rama `q.image != null`.
 */
const LOW_DENSITY_AVG_CHARS = 150;

/**
 * Decide la densidad de impresión de una sección.
 *
 * Reglas (en orden):
 * 1. Sección vacía → "high" (no hay nada que compactar).
 * 2. Un solo ítem → "high" (no se beneficia de 2 columnas).
 * 3. Algún ítem con imagen o tabla → "high" (rompe el flujo de columna, ya
 *    hay un `.question.wide` que cruza columnas; una sección mixta con UN
 *    wide entre 10 short queda visualmente rota).
 * 4. Promedio de chars/ítem < 150 → "low".
 * 5. Else → "high".
 */
export function computeSectionDensity(section: EvaluationSection): SectionDensity {
  const items = section.questions;
  if (items.length === 0) return "high";
  if (items.length === 1) return "high";
  if (items.some((q) => q.image != null)) return "high";

  const totalChars = items.reduce((sum, q) => {
    const textChars = richTextCharCount(q.text);
    const optChars = q.options.reduce((s, o) => s + richTextCharCount(o.text), 0);
    return sum + textChars + optChars;
  }, 0);
  const avgChars = totalChars / items.length;

  return avgChars < LOW_DENSITY_AVG_CHARS ? "low" : "high";
}

/**
 * Cuenta los caracteres visibles de un documento TipTap.
 *
 * Recorre recursivamente y suma los nodos `text`. Imágenes, tablas,
 * hard-breaks y otros nodos sin `text` cuentan 0 (contribuyen altura, no
 * anchura de columna). El campo `text` de nodos `math` cuenta como texto
 * crudo — coincide con el render, que muestra la expresión LaTeX si el
 * visualizador falla.
 *
 * Tolera `null`, strings y estructuras inválidas (devuelve 0) porque las
 * preguntas viejas en la BD pueden tener `text: null` o `text: ""`.
 */
export function richTextCharCount(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") return value.length;

  let n = 0;
  walk(value, (node) => {
    if (
      typeof node === "object" &&
      node !== null &&
      "text" in node &&
      typeof (node as { text: unknown }).text === "string"
    ) {
      n += (node as { text: string }).text.length;
    }
  });
  return n;

  function walk(node: unknown, visit: (n: unknown) => void): void {
    visit(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child, visit);
      return;
    }
    if (node && typeof node === "object") {
      const content = (node as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const child of content) walk(child, visit);
      }
    }
  }
}
