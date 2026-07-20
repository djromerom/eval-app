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
