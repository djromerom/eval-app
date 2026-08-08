/**
 * Helpers puros para el bloque "Contexto" del editor unificado.
 *
 * El bloque tiene dos campos:
 *  - `title`: string en el input controlado por `draftSectionTitle`
 *  - `content`: doc TipTap serializado en `draftSectionContent`
 *
 * El orquestador de "Agregar enunciado" (`unified-editor.tsx > overrideAction`)
 * responde dos preguntas:
 *
 *  1. ¿El docente escribió algo? → `hasUnsavedContexto()`
 *     (EMPTY_DOC de TipTap cuenta como "vacío"). El orquestador lo usa
 *     para el debounce pre-flight (lockout anti-doble-submit cuando el
 *     docente tipeó algo) y para decidir si crear/renombrar sección.
 *
 *  2. ¿Qué sección usar para la nueva pregunta? La decisión NO pasa
 *     por comparar contenido/título. Pasa por `targetSectionId` (la
 *     sección destino que el docente fijó vía el contexto visible
 *     arriba). Si `targetSectionId` apunta a una sección CON contenido,
 *     se REUSA. Si no, se cae en la rama legacy: rename-empty si hay
 *     1 sección vacía, o create-new si no.
 *
 * Por eso `contextoMatchesSection()` se eliminó (ago 2026): comparaba
 * título+contenido y producía secciones duplicadas cuando el docente
 * refinaba el título de su contexto entre dos "Agregar enunciado"
 * consecutivos. La nueva regla es: el id es la verdad; el draft del
 * docente es input libre, no decide la sección destino. Si el docente
 * quiere modificar el contexto destino, debe pulsar explícitamente el
 * botón "Editar contexto" del bloque Contexto (que llama a
 * `handleUpdateContext` → `updateSectionAction`).
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
