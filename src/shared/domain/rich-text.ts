/**
 * Texto plano de un documento TipTap.
 *
 * Vive en `shared/domain` y no en `components/editor` porque lo necesitan tres
 * sitios con restricciones distintas:
 *
 * - Los use cases de importación (capa de aplicación), que no deben importar
 *   de `components/`.
 * - El formulario de preguntas (cliente), donde importar `editor/render`
 *   arrastraría `@tiptap/html` y KaTeX al bundle del navegador.
 * - Las páginas de impresión (servidor).
 *
 * Es una función pura sin dependencias: solo recorre el JSON.
 *
 * OJO con la semántica, que se conserva tal cual estaba en `editor/render`
 * porque de ella depende lo que se imprime: el `trim` se aplica UNA vez al
 * final (no por nivel) y los nodos se unen con un espacio.
 */
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

/**
 * Determina si un documento TipTap tiene contenido renderizable a nivel de
 * bloque. Lo usan las páginas de impresión (`/print/evaluation/[id]`,
 * `/print/bundle/[id]`) para decidir si mostrar el bloque de contexto de
 * una sección.
 *
 * Por qué hace falta: `richTextToPlain` solo extrae `node.text`. Cuando el
 * contexto es SOLO una imagen, una tabla o un `blockMath` (sin texto
 * acompañante), devuelve "" y la página de impresión oculta el bloque
 * entero, perdiendo la imagen. Esta función cuenta también esos nodos:
 * - `paragraph` cuenta si tiene al menos un hijo (un `<p></p>` vacío, lo
 *   que devuelve TipTap al inicializar, no cuenta).
 * - Cualquier otro nodo top-level (`image`, `table`, `blockMath`,
 *   `heading`, etc.) cuenta con solo estar presente.
 */
export function richTextHasRenderableContent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const doc = value as { content?: unknown[] };
  if (!Array.isArray(doc.content) || doc.content.length === 0) return false;
  return doc.content.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const node = raw as { type?: string; content?: unknown[] };
    if (node.type === "paragraph") {
      return Array.isArray(node.content) && node.content.length > 0;
    }
    return typeof node.type === "string";
  });
}
