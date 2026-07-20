/**
 * Formato intermedio de la importación de preguntas.
 *
 * Los tres orígenes —documento del docente, plantilla CSV y otra evaluación
 * del sistema— convierten a esta forma, y de aquí sale una única pantalla de
 * revisión y un único camino de alta. Añadir un origen nuevo es escribir un
 * parser que devuelva `ParseResult`; nada más del flujo cambia.
 *
 * El texto viaja como STRING plano, no como documento TipTap: lo que se lee
 * de un Word o un CSV no trae formato aprovechable, y el docente lo enriquece
 * después en el editor. Convertirlo a TipTap se hace al dar de alta.
 *
 * Las imágenes sí viajan como URL del upload propio (Fase 3 / parser DOCX):
 * mammoth las entrega en base64, se suben a `/api/uploads` y se guardan aquí
 * ya servibles por la app.
 */
import {
  ANSWER_KEYS_ORDER,
  type AnswerKey,
  MAX_OPTIONS,
  MIN_OPTIONS,
  validateQuestionShape,
} from "@/modules/evaluations/domain/evaluation";

/**
 * Imagen inline de una pregunta. Una sola por pregunta para mantener simple
 * el modelo; si el DOCX trae varias antes del enunciado, se conserva la
 * última (la más cercana al texto) y el resto se descarta con un aviso.
 */
export interface ParsedQuestionImage {
  url: string;
}

/** Pregunta leída de una fuente externa, antes de validar y confirmar. */
export interface ParsedQuestion {
  /**
   * Número que traía en el documento. Sirve para ordenar y para casar con la
   * tabla de clave del DOCX. `null` si la fuente no numera (p. ej. un CSV).
   */
  sourceNumber: number | null;
  text: string;
  options: { key: AnswerKey; text: string }[];
  /** `null` = la fuente no dice cuál es. El docente la marca en la revisión. */
  correctAnswer: AnswerKey | null;
  competency: string | null;
  evidence: string | null;
  /** Contexto al que pertenecía, si la fuente agrupaba preguntas. */
  contextTitle: string | null;
  contextText: string | null;
  /** Imagen inline adjunta (solo el parser DOCX la rellena hoy). */
  image: ParsedQuestionImage | null;
  /** Lo que el parser no pudo resolver; se pinta en la revisión. */
  warnings: string[];
}

export interface ParseResult {
  questions: ParsedQuestion[];
  /** Problemas globales: no se halló la tabla de clave, formato desconocido… */
  warnings: string[];
}

/** Motivo por el que una pregunta no se puede dar de alta tal cual. */
export interface ParsedQuestionProblem {
  /** Índice 0-based en el array; la UI muestra `sourceNumber` si lo hay. */
  index: number;
  message: string;
}

/**
 * Comprueba que una pregunta leída se puede dar de alta.
 *
 * Reutiliza `validateQuestionShape` (el mismo validador que usan el alta
 * manual y el banco) para no tener dos definiciones de "pregunta válida" que
 * se puedan separar con el tiempo. Solo añade lo propio de la importación:
 * el enunciado no puede estar vacío y la correcta puede venir sin marcar.
 *
 * Devuelve `null` si es válida, o el mensaje del problema.
 */
export function validateParsedQuestion(q: ParsedQuestion): string | null {
  if (!q.text.trim()) return "La pregunta no tiene enunciado.";

  if (q.options.length < MIN_OPTIONS) {
    return `Solo se leyeron ${q.options.length} opción(es); hacen falta al menos ${MIN_OPTIONS}.`;
  }
  if (q.options.length > MAX_OPTIONS) {
    return `Se leyeron ${q.options.length} opciones; el máximo es ${MAX_OPTIONS} (A–H).`;
  }
  if (q.options.some((o) => !o.text.trim())) {
    return "Hay opciones vacías.";
  }
  if (q.correctAnswer === null) {
    return "Falta marcar la respuesta correcta.";
  }

  // El resto (claves consecutivas y únicas, correcta entre las opciones) ya lo
  // sabe el dominio de evaluaciones.
  return validateQuestionShape({ options: q.options, correctAnswer: q.correctAnswer });
}

/** Separa las preguntas listas para dar de alta de las que tienen problemas. */
export function partitionParsedQuestions(questions: ParsedQuestion[]): {
  valid: ParsedQuestion[];
  problems: ParsedQuestionProblem[];
} {
  const valid: ParsedQuestion[] = [];
  const problems: ParsedQuestionProblem[] = [];

  questions.forEach((q, index) => {
    const message = validateParsedQuestion(q);
    if (message) problems.push({ index, message });
    else valid.push(q);
  });

  return { valid, problems };
}

/**
 * Reasigna las claves de opción a A, B, C… en orden.
 *
 * Los parsers pueden leer opciones con claves desordenadas o con huecos (un
 * Word donde falta la C, o donde una opción se escribió con `B,` en vez de
 * `B.`). El dominio exige claves consecutivas desde A, así que se normalizan
 * conservando el orden en que aparecían.
 *
 * Si la correcta apuntaba a una clave concreta, se traslada a su nueva
 * posición; si esa opción ya no existe, se devuelve `null` para que la
 * revisión obligue a marcarla.
 */
export function normalizeOptionKeys(q: ParsedQuestion): ParsedQuestion {
  const previousCorrectIndex =
    q.correctAnswer === null ? -1 : q.options.findIndex((o) => o.key === q.correctAnswer);

  const options = q.options.map((o, i) => ({ key: ANSWER_KEYS_ORDER[i]!, text: o.text }));
  const correctAnswer =
    previousCorrectIndex >= 0 ? (ANSWER_KEYS_ORDER[previousCorrectIndex] ?? null) : null;

  return { ...q, options, correctAnswer };
}
