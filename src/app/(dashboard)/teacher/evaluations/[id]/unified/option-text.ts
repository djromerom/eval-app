/**
 * Helpers puros para el campo de opción ADAPTATIVO del QuestionForm.
 *
 * Vista general (ago 2026, pedido del docente):
 *  - El OptionInput decide si mostrar un `<Input>` plano o un
 *    `<RichTextEditor variant="option">` con toolbar mínima.
 *  - La decisión la toma `isComplexOption(value)` examinando el doc
 *    TipTap sin instanciar React.
 *  - Este archivo NO importa React, TipTap ni nada del cliente: es
 *    importable desde tests unitarios de Node (sin jsdom).
 */

/**
 * Tipos de nodo TipTap que indican formato complejo en una opción
 * (math, imagen, tabla). Coinciden con la nomenclatura de
 * `extensions.ts` (ago 2026).
 *
 * Lista explícita y no heurística "si no es string" porque las
 * opciones vacías se serializan como string "" o como
 * `{type:"doc", content:[]}` — ambos deben seguir siendo
 * renderizados con Input plano, no con RichTextEditor.
 */
const COMPLEX_OPTION_NODE_TYPES = ["math-inline", "math-block", "image", "tableBlock"] as const;

/** ¿El texto de la opción tiene formato complejo (math/imagen/tabla)? */
export function isComplexOption(text: unknown): boolean {
  if (typeof text === "string") return false;
  if (!text || typeof text !== "object") return false;
  // Recorremos todos los `type` string del árbol via JSON.stringify —
  // rápido y suficiente para este chequeo. El doc TipTap puede estar
  // en la raíz (type:"doc") o anidado dentro de un wrapper.
  const json = JSON.stringify(text);
  return COMPLEX_OPTION_NODE_TYPES.some((t) => json.includes(`"type":"${t}"`));
}
