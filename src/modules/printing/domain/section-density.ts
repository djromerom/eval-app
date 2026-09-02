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
 * (override `columnLayoutOverride` en `EvaluationSection`). `resolveSectionDensity`
 * aplica el override sobre la heurística.
 */

import type { EvaluationSection } from "@/modules/evaluations/domain/evaluation";
import type { SectionGroup } from "@/modules/printing/domain/section-grouping";

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
 * Resuelve la densidad efectiva de impresión: aplica el override del docente
 * (si existe) sobre la heurística.
 *
 * - `columnLayoutOverride === "2col"` → `"low"` (forzar 2 columnas).
 * - `columnLayoutOverride === "1col"` → `"high"` (forzar 1 columna).
 * - `columnLayoutOverride === null` → heurística decide.
 *
 * Las páginas de impresión (`/print/bundle/[id]`, `/print/evaluation/[id]`)
 * usan esta función en vez de `computeSectionDensity` directamente para que
 * el override llegue al render sin lógica duplicada.
 */
export function resolveSectionDensity(section: EvaluationSection): SectionDensity {
  if (section.columnLayoutOverride === "2col") return "low";
  if (section.columnLayoutOverride === "1col") return "high";
  return computeSectionDensity(section);
}

/**
 * Densidad efectiva de impresión de un grupo.
 *
 * - `single` → delega en `resolveSectionDensity` (override + heurística).
 * - `none-merged` → no se respeta override por sección (perderíamos la
 *   granularidad al fusionar); se calcula la densidad sumando chars e
 *   ítems de todas las secciones fusionadas, lo cual activa la regla
 *   de "muchos ítems cortos juntos → low" que cada sección por separado
 *   no vería (recordar que un solo ítem ya devuelve "high").
 *
 * Si el docente quiere forzar 2-col en un grupo `none-merged`, debe poner
 * el override en la PRIMERA sección del run; el render del grupo toma el
 * override de esa sección como señal global. Cualquier override de las
 * secciones interiores del grupo se ignora a propósito.
 */
export function resolveGroupDensity(group: SectionGroup): SectionDensity {
  if (group.kind === "single") {
    return resolveSectionDensity(group.section);
  }
  const first = group.sections[0];
  if (first?.columnLayoutOverride === "2col") return "low";
  if (first?.columnLayoutOverride === "1col") return "high";
  return computeGroupDensity(group);
}

/**
 * Heurística pura de densidad para un grupo (sin override).
 *
 * - Grupo vacío → "high" (nada que compactar).
 * - Algún ítem con imagen → "high" (la imagen rompe el flujo de columna).
 * - Promedio de chars/ítem < `LOW_DENSITY_AVG_CHARS` → "low".
 * - Else → "high".
 *
 * Para grupos `single` delega en `computeSectionDensity` (mismas reglas:
 * 0 ítems → high; 1 ítem → high; imagen → high; else por chars/ítem).
 */
export function computeGroupDensity(group: SectionGroup): SectionDensity {
  if (group.kind === "single") return computeSectionDensity(group.section);

  const allItems = group.sections.flatMap((s) => s.questions);
  if (allItems.length === 0) return "high";
  if (allItems.length === 1) return "high";
  if (allItems.some((q) => q.image != null)) return "high";

  const totalChars = allItems.reduce((sum, q) => {
    const textChars = richTextCharCount(q.text);
    const optChars = q.options.reduce((s, o) => s + richTextCharCount(o.text), 0);
    return sum + textChars + optChars;
  }, 0);
  const avgChars = totalChars / allItems.length;

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
