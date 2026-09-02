/**
 * Agrupa secciones consecutivas del cuadernillo para imprimir.
 *
 * Caso típico (sprint Sep 2026, pedido del docente): cuando un docente crea
 * varios contextos seguidos con el tipo "ninguno" (sin título, sin contenido)
 * para cargar ítems sueltos — p.ej. un examen de Inglés de "PARTE 1" con 5
 * preguntas de matching, luego "PARTE 2" con 4 preguntas de V/F, etc. — cada
 * "ninguno" se imprime actualmente como un bloque con su propio divider y su
 * propia decisión de densidad. Como cada parte tiene pocos ítems cortos, la
 * heurística por sección las marcaba "high" (un solo ítem no se beneficia de
 * 2-col, sección vacía → high) y se rendereaban a 1-col, dejando la mitad de
 * la página en blanco entre ítems.
 *
 * Esta capa aplana las "ninguno" consecutivas en un solo bloque de impresión
 * que salta los section-divider intermedios y suma los ítems para el cálculo
 * de densidad. El resultado: matching + V/F juntos pasan a 2-col sin perder
 * los contextos con título/contenido propios (esos siguen siendo su propio
 * grupo `single` y conservan su divider).
 *
 * Función pura sobre `EvaluationSection[]`. Sin estado, sin DOM, sin BD.
 * Las páginas de impresión iteran el resultado en vez de la lista de
 * secciones y aplican `computeGroupDensity` para decidir columnas.
 *
 * Decisión de diseño: NO se aplica override manual aquí — la heurística se
 * calcula por GRUPO, no por sección, porque el override apunta a una sección
 * y al fusionarlas perdería la granularidad. Si el docente quiere forzar 2-col
 * en un grupo, que ponga el override en la primera sección del run.
 */

import type { EvaluationSection } from "@/modules/evaluations/domain/evaluation";
import { richTextHasRenderableContent } from "@/shared/domain/rich-text";

/**
 * Bloque de impresión. La forma `single` representa una sección que se imprime
 * tal cual (con su divider, con su override propio). La forma `none-merged`
 * representa N secciones "ninguno" consecutivas que se aplanan en un solo
 * bloque sin divider entre ellas.
 */
export type SectionGroup =
  | { kind: "single"; section: EvaluationSection }
  | { kind: "none-merged"; sections: EvaluationSection[] };

/**
 * Una sección es "ninguno" cuando no tiene contexto asociado a nivel de bloque.
 * Equivale a la condición que el docente usa en el editor de secciones para
 * marcar un placeholder vacío (sin título, sin contenido renderizable).
 *
 * Por qué se chequea también el contenido: en el editor, crear un contexto
 * vacío desde el botón "+ Agregar contexto" suele persistir `title: null` y
 * `content: null` pero a veces queda un `content` con un párrafo TipTap vacío
 * (lo que devuelve `RichTextEditor` antes de tipear). `richTextHasRenderableContent`
 * ya trata `<p></p>` como no-contenido, así que la condición sigue siendo
 * robusta.
 */
export function isNingunoSection(section: EvaluationSection): boolean {
  if (section.title != null && section.title.trim().length > 0) return false;
  return !richTextHasRenderableContent(section.content);
}

/**
 * Agrupa las secciones en bloques de impresión.
 *
 * Recorre la lista en orden y aplica la regla:
 * - Sección "con contexto" (no-ninguno) → emite un grupo `single`.
 * - Sección "ninguno" → extiende el grupo `none-merged` actual; si no hay
 *   uno abierto, abre uno.
 *
 * El resultado preserva el orden original y nunca emite un grupo `none-merged`
 * vacío ni de un solo elemento (un grupo de 1 siempre es `single`).
 */
export function groupSectionsForPrint(sections: EvaluationSection[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  let currentNinguno: EvaluationSection[] = [];

  const flushSingle = (s: EvaluationSection) => {
    groups.push({ kind: "single", section: s });
  };

  const flushNinguno = () => {
    if (currentNinguno.length === 0) return;
    if (currentNinguno.length === 1) {
      groups.push({ kind: "single", section: currentNinguno[0]! });
    } else {
      groups.push({ kind: "none-merged", sections: [...currentNinguno] });
    }
    currentNinguno = [];
  };

  for (const section of sections) {
    if (isNingunoSection(section)) {
      currentNinguno.push(section);
    } else {
      flushNinguno();
      flushSingle(section);
    }
  }
  flushNinguno();

  return groups;
}
