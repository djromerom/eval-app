/**
 * Helpers puros para el bloque "Contexto" del editor unificado.
 *
 * El bloque tiene dos campos:
 *  - `title`: string en el input controlado por `draftSectionTitle`
 *  - `content`: doc TipTap serializado en `draftSectionContent`
 *
 * Dos preguntas que el orquestador de "Agregar enunciado" debe responder:
 *
 *  1. ¿El docente escribió algo? → `hasUnsavedContexto()`
 *     (EMPTY_DOC de TipTap cuenta como "vacío").
 *
 *  2. Lo que escribió, ¿es DIFERENTE al contexto de la sección destino?
 *     → `contextoMatchesSection()`
 *     Esto evita el bug clásico: tras un "Agregar enunciado" exitoso, los
 *     drafts quedan precargados con el título/contenido de la sección recién
 *     creada. Si el docente añade OTRA pregunta sin tocar los inputs, el draft
 *     "viejo" coincide con la sección destino y NO debe disparar la creación
 *     de una sección nueva. Solo se crea sección nueva cuando el docente
 *     efectivamente escribió algo DISTINTO.
 */

/**
 * Detecta si el bloque "Contexto" tiene datos pendientes por guardar.
 *
 * Consideramos "vacío" cuando:
 *  - title es null/undefined/whitespace, Y
 *  - content es null/undefined o es el EMPTY_DOC de TipTap (`{type:"doc",
 *    content:[{type:"paragraph"}]}` — un solo párrafo sin texto).
 *
 * Devuelve true cuando hay título o contenido real. Es la respuesta a
 * "¿el docente escribió algo que no estaba ya en la BD?".
 */
export function hasUnsavedContexto(title: string | null | undefined, content: unknown): boolean {
  if (title && title.trim().length > 0) return true;
  if (!content || typeof content !== "object") return false;
  const node = content as { type?: string; content?: unknown[] };
  if (node.type !== "doc") return false;
  if (!Array.isArray(node.content)) return true;
  if (node.content.length === 0) return false;
  if (node.content.length === 1) {
    const first = node.content[0] as { type?: string; content?: unknown[] };
    if (first.type === "paragraph") {
      if (!Array.isArray(first.content) || first.content.length === 0) return false;
      const textNode = first.content[0] as { text?: string };
      if (typeof textNode?.text === "string" && textNode.text.trim().length === 0) {
        return false;
      }
    }
  }
  return true;
}

/**
 * ¿El draft del docente coincide con el contexto ya guardado en `section`?
 *
 * Devuelve true cuando título y contenido son EQUIVALENTES palabra por
 * palabra. Usado por el orquestador de "Agregar enunciado" para decidir
 * si debe reusar la sección destino (camino rápido) o crear/renombrar
 * una sección.
 *
 * Casos cubiertos:
 *  - sección vacía (title=null, content=null) y draft vacío → true
 *    (no hay nada que persistir, la pregunta va a la sección vacía).
 *  - sección con "Contexto A" y draft="Contexto A" → true (reusar).
 *  - sección con "Contexto A" y draft="Contexto B" → false (crear nueva).
 *  - sección vacía y draft con texto → false (renombrar la vacía).
 *
 * IMPORTANTE (ago 2026, pedido del docente): NO dedupe por título
 * contra OTRAS secciones. Este comparador SOLO decide si el draft
 * coincide con la sección DESTINO (`targetSection`). El id es la
 * verdad; si el docente escribe un título que coincide con el de una
 * sección que NO es la destino, igual debe crear una nueva → ese
 * camino lo maneja el removeByTitle del orquestador, no este
 * comparador.
 */
export function contextoMatchesSection(
  draftTitle: string | null | undefined,
  draftContent: unknown,
  section: { title: string | null; content: unknown } | null | undefined,
): boolean {
  if (!section) return false;
  const draftHasText = hasUnsavedContexto(draftTitle, draftContent);
  const sectionHasText = hasUnsavedContexto(section.title, section.content);

  // Ambos vacíos → coincide (no hay nada que guardar).
  if (!draftHasText && !sectionHasText) return true;
  // Solo uno tiene texto → no coincide (hay que persistir el del docente).
  if (draftHasText !== sectionHasText) return false;
  // Ambos tienen texto → comparar título Y contenido (por valor JSON).
  // El draft del bloque Contexto puede haber sido editado tanto en el
  // Input (título) como en el RichTextEditor (contenido). Si AMBOS
  // coinciden con la sección destino, reusamos. Si difieren en
  // cualquiera, hay que crear/renombrar — incluso si el título
  // coincide (caso típico: el docente pegó el mismo texto del TipTap
  // por accidente, o el título repetido es legítimo).
  const titleMatches = (draftTitle ?? "").trim() === (section.title ?? "").trim();
  const contentMatches =
    JSON.stringify(draftContent ?? null) === JSON.stringify(section.content ?? null);
  return titleMatches && contentMatches;
}
