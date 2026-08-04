/**
 * Determina si el JSON de un RichTextEditor (TipTap) representa un documento
 * sin texto real (solo estructura vacía). Lo usa `question-form.tsx` para
 * impedir que el botón "Agregar enunciado" cree ítems con `Texto = (vacío)`
 * cuando el docente olvidó escribir el enunciado pero sí llenó opciones.
 *
 * Casos cubiertos:
 *  - `null` / `undefined` → vacío.
 *  - string `""` o solo whitespace → vacío.
 *  - `{type:"doc",content:[{type:"paragraph"}]}` (EMPTY_DOC) → vacío.
 *  - párrafo con text node vacío o solo whitespace → vacío.
 *  - cualquier nodo con `text.trim().length > 0` en algún descendiente → NO vacío.
 *  - imagen, tabla, etc. sin texto (p.ej. solo `type:"image"`) → vacío para
 *    los fines de "enunciado": el docente debe redactar la pregunta, no
 *    colgar solo una imagen.
 *
 * Decisión: imágenes y tablas sin texto cuentan como vacío. La validación
 * es sobre el ENUNCIADO de la pregunta, no sobre el contexto (que tiene
 * su propio campo). Si el docente quiere enunciado = solo imagen, debe
 * acompañarlo de un pie de foto o caption — la lógica de impresión ya lo
 * permite pero para el form pedimos al menos una línea de texto.
 */
export function isTipTapEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value !== "object") return true;
  const node = value as { text?: string; content?: unknown[] };
  // Cualquier nodo con texto real (no whitespace) basta para considerar el
  // documento no-vacío.
  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return false;
  }
  // Recursivo: si ALGÚN hijo tiene texto, no está vacío. Si todos están
  // vacíos, el doc actual también lo está.
  if (Array.isArray(node.content)) {
    return node.content.every(isTipTapEmpty);
  }
  return true;
}
