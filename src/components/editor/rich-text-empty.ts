/**
 * Determina si el JSON de un RichTextEditor (TipTap) representa un documento
 * sin contenido renderizable. Lo usan `question-form.tsx`,
 * `unified-editor.tsx` y los use cases para impedir que se guarden ítems
 * con campos vacíos (enunciado, opción, contexto).
 *
 * Casos cubiertos:
 *  - `null` / `undefined` → vacío.
 *  - string `""` o solo whitespace → vacío.
 *  - `{type:"doc",content:[{type:"paragraph"}]}` (EMPTY_DOC) → vacío.
 *  - párrafo con text node vacío o solo whitespace → vacío.
 *  - cualquier nodo con `text.trim().length > 0` en algún descendiente → NO vacío.
 *  - nodo de tipo renderizable sin texto (image, table, heading,
 *    blockquote, blockMath, etc.) → NO vacío (ago 2026: pedido del docente,
 *    "permite guardar si hay solo imagenes" — antes se rechazaba con
 *    "Describe el enunciado de la pregunta" para enunciados de solo imagen,
 *    pero la lógica de impresión ya renderiza estos nodos, así que es
 *    trabajo válido). Solo `doc`, `paragraph` y `text` son estructurales:
 *    necesitan hijos para tener contenido.
 *
 * NO confundir con `richTextToPlain`: esa función extrae SOLO texto para
 * snippets/impresión. Esta función decide si el documento está vacío para
 * efectos de validación de guardado.
 */
export function isTipTapEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (typeof value !== "object") return true;
  const node = value as { type?: string; text?: string; content?: unknown[] };
  // Cualquier nodo con texto real (no whitespace) basta para considerar el
  // documento no-vacío.
  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return false;
  }
  // Nodos no-estructurales y no-texto (image, table, heading, blockquote,
  // blockMath, etc.) cuentan como contenido renderizable aunque no tengan
  // texto. Ejemplos típicos: `{type:"image", attrs:{src:"..."}}`,
  // `{type:"table", content:[...]}`, `{type:"heading", attrs:{level:3}}`.
  // Solo `doc` y `paragraph` son estructurales: necesitan hijos para
  // tener contenido. `text` no tiene `type` propio en TipTap, pero por
  // seguridad también lo tratamos como estructural.
  if (
    typeof node.type === "string" &&
    node.type !== "doc" &&
    node.type !== "paragraph" &&
    node.type !== "text"
  ) {
    return false;
  }
  // Recursivo: si TODOS los hijos están vacíos, este nodo también lo está.
  // Si alguno tiene contenido, no está vacío.
  if (Array.isArray(node.content)) {
    return node.content.every(isTipTapEmpty);
  }
  return true;
}
