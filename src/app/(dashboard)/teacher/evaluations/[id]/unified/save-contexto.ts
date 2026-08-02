/**
 * Helper puro: detecta si el estado del bloque "Contexto" del editor unificado
 * tiene datos pendientes por guardar.
 *
 * El bloque tiene dos campos:
 *  - `title`: string en el input controlado por `draftSectionTitle`
 *  - `content`: doc TipTap serializado en `draftSectionContent`
 *
 * Consideramos "vacío" cuando:
 *  - title es null/undefined/whitespace, Y
 *  - content es null/undefined o es el EMPTY_DOC de TipTap (`{type:"doc",
 *    content:[{type:"paragraph"}]}` — un solo párrafo sin texto).
 *
 * Devuelve true cuando hay que persistir el contexto antes de guardar la
 * pregunta (es decir, hay título o contenido real).
 *
 * El chequeo de EMPTY_DOC es importante: el RichTextEditor siempre emite un
 * doc (no null), pero cuando el docente no ha escrito nada el doc es el
 * placeholder vacío. Si lo tratáramos como "con contenido", cada "Agregar
 * enunciado" intentaría guardar un contexto con texto vacío.
 */
export function hasUnsavedContexto(title: string | null | undefined, content: unknown): boolean {
  if (title && title.trim().length > 0) return true;
  if (!content || typeof content !== "object") return false;
  // EMPTY_DOC de TipTap = un solo párrafo sin texto. Lo descartamos.
  const node = content as { type?: string; content?: unknown[] };
  if (node.type !== "doc") return false;
  if (!Array.isArray(node.content)) return true;
  if (node.content.length === 0) return false;
  // Un doc con un solo párrafo vacío cuenta como EMPTY_DOC.
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
