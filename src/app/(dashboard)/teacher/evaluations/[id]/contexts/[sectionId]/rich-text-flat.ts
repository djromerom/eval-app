/**
 * Aplana TipTap JSON a un string sin tirar de `@tiptap/html` ni del bundle del
 * editor en el cliente. Se usa en el bloque de lectura de cada pregunta del
 * editor por contexto (Fase 10) y se testea unitariamente.
 *
 * Si es string, se devuelve tal cual. Si es un nodo, se extrae `text` o se
 * aplana recursivamente `content`. Es deliberadamente minimal: cualquier
 * marca (negrita, cursiva, fórmulas KaTeX) se ignora — para preview rápido
 * el texto plano es suficiente. Para la edición se usa `<RichText>` del
 * editor TipTap, que sí renderiza marcas.
 */
export function renderTipTap(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) return node.content.map(renderTipTap).join(" ");
  return "";
}
