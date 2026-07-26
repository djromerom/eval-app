import type { ParsedQuestion } from "../domain/parsed-question";
import { contextTextToTipTap } from "./context-to-tiptap";

/**
 * Helpers para preservar el contexto compartido cuando importamos preguntas
 * desde DOCX/CSV/otra formulación.
 *
 * Hoy la BD no tiene una columna `contextText` por pregunta:
 *  - En `EvaluationSection`, el contexto se almacena en `section.content`
 *    (TipTap) UNA sola vez para todas las preguntas que lo comparten.
 *  - En `QuestionBank`, no hay slot de contexto. Si una pregunta importada
 *    del banco trae contexto, lo embebemos al inicio de su TipTap `text`
 *    (con un encabezado "Contexto") para no perder información.
 *
 * Los helpers de este módulo son puros y testeables sin BD ni TipTap runner.
 */

// ---------- TipTap (mínimo subset que necesitamos) ----------

type TipTapNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  /** Presente solo en nodos hoja `type: "text"`. */
  text?: string;
};

/** Documento TipTap con `type === "doc"` o estructura vacía. */
export type TipTapDoc = {
  type: "doc";
  content: TipTapNode[];
};

/** Bloque separador entre contextos cuando la sección ya tenía contenido. */
function horizontalRule(): TipTapNode {
  return { type: "horizontalRule" };
}

/** Bloque para encabezado "Contexto" en el banco. */
function contextHeading(title: string | null): TipTapNode {
  return {
    type: "heading",
    attrs: { level: 3 },
    content: [{ type: "text", text: title?.trim() || "Contexto" }],
  };
}

function isTipTapDoc(value: unknown): value is TipTapDoc {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "doc" && Array.isArray(v.content);
}

function asTipTapDoc(value: unknown): TipTapDoc {
  if (isTipTapDoc(value)) return value;
  return { type: "doc", content: [] };
}

// ---------- API pública ----------

/**
 * Devuelve los textos de contexto ÚNICOS que aparecen en el batch,
 * preservando el orden de aparición. Ignora `null` y los duplicados tras
 * `trim()`. Si el batch tiene 50 preguntas con el mismo "Contexto A",
 * `collectUniqueContexts` lo devuelve UNA sola vez.
 */
export function collectUniqueContexts(questions: ParsedQuestion[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of questions) {
    const text = q.contextText?.trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * Combina los contextos compartidos con el contenido actual del contexto de
 * formulación. Si el destino ya tiene contenido, inserta un `horizontalRule`
 * antes del primer contexto nuevo para que el docente los distinga en la
 * maquetación.
 *
 * Si `contexts` está vacío, devuelve `current` tal cual (útil cuando una
 * importación llega sin contexto compartido).
 *
 * `contextImagesByText` mapea cada `contextText` único al mapa
 * `id → url` para las figuras referenciadas dentro de él. Si una
 * entrada falta, ese contexto se parsea igual pero los placeholders
 * `[IMAGEN id]` quedan como texto literal (comportamiento por
 * defecto).
 */
export function mergeContextsIntoSectionContent(
  current: unknown,
  contexts: string[],
  contextImagesByText?: Record<string, Record<string, string>>,
): TipTapDoc {
  if (contexts.length === 0) return asTipTapDoc(current);
  const base = asTipTapDoc(current);
  // Cada contexto se parsea en busca de bloques `[TABLA: ...]` y
  // placeholders `[IMAGEN id]` para emitir nodos `table` / `image`
  // reales; el resto queda como `paragraph`. El comportamiento para
  // contextos SIN tablas ni imágenes es idéntico al anterior (un
  // solo `paragraph` con todo el texto).
  const blocks: TipTapNode[] = contexts.flatMap((c) =>
    contextTextToTipTap(c, contextImagesByText?.[c]),
  );
  const separator = base.content.length > 0 ? [horizontalRule()] : [];
  return { type: "doc", content: [...base.content, ...separator, ...blocks] };
}

/**
 * Devuelve una copia del TipTap `text` de la pregunta con el contexto
 * antepuesto en su inicio (heading "Contexto" + el párrafo de texto).
 * Si la pregunta no trae contexto, devuelve el `text` original sin tocarlo.
 *
 * Se usa en la ruta al banco porque `QuestionBank` no tiene slot propio
 * para contexto compartido. Es una pérdida de estructura: si la pregunta
 * se reusa en una formulación, el contexto la "sigue" como parte de su
 * enunciado.
 *
 * `contextImages` es el mapa `id → url` para las figuras referenciadas
 * dentro del `contextText`. Si no se pasa, los placeholders `[IMAGEN id]`
 * quedan como texto literal.
 */
export function prependContextToBankQuestion(
  text: unknown,
  contextTitle: string | null,
  contextText: string,
  contextImages?: Record<string, string>,
): TipTapDoc {
  const base = asTipTapDoc(text);
  const trimmed = contextText.trim();
  if (trimmed.length === 0) return base;
  const header = contextHeading(contextTitle);
  // Parsea el contexto en busca de bloques `[TABLA: ...]` y
  // placeholders `[IMAGEN id]` para emitir nodos `table` / `image`
  // reales; el resto queda como `paragraph`. Para un contexto SIN
  // tablas ni imágenes, el resultado es el mismo `paragraph` de antes.
  const intro = contextTextToTipTap(trimmed, contextImages);
  return {
    type: "doc",
    content: [header, ...intro, ...base.content],
  };
}

/**
 * Devuelve una copia de las preguntas SIN `contextText`/`contextTitle`,
 * para evitar duplicar el contexto si lo acabamos de promover al section
 * (ruta formulación) o si la ruta de banco va a embeberlo en el `text`
 * (que ya no debería traer la cadena original).
 */
export function stripContextFromQuestions(questions: ParsedQuestion[]): ParsedQuestion[] {
  return questions.map((q) => ({
    ...q,
    contextText: null,
    contextTitle: null,
  }));
}
