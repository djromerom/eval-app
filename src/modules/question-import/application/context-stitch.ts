import type { ParsedQuestion } from "../domain/parsed-question";

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

/** Bloque mínimo: un párrafo con texto plano. */
function paragraph(text: string): TipTapNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

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
 */
export function mergeContextsIntoSectionContent(current: unknown, contexts: string[]): TipTapDoc {
  if (contexts.length === 0) return asTipTapDoc(current);
  const base = asTipTapDoc(current);
  const blocks: TipTapNode[] = contexts.map(paragraph);
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
 */
export function prependContextToBankQuestion(
  text: unknown,
  contextTitle: string | null,
  contextText: string,
): TipTapDoc {
  const base = asTipTapDoc(text);
  const trimmed = contextText.trim();
  if (trimmed.length === 0) return base;
  const header = contextHeading(contextTitle);
  const intro = paragraph(trimmed);
  return {
    type: "doc",
    content: [header, intro, ...base.content],
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
