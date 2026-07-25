import { type Context, type ExtractedQuestion, type ExtractionChunk } from "./types";

export interface MergedExtraction {
  contexts: Context[];
  questions: ExtractedQuestion[];
}

/** Normaliza un título para comparar contextos duplicados. */
function normTitle(t: string | null): string {
  return (t ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Fusiona los resultados de todos los chunks:
 *  - Preguntas: dedupe por `number`; se conserva la versión con más opciones /
 *    enunciado más largo (asumida como la más completa).
 *  - Contextos: dedupe por título normalizado (o por texto si no hay título);
 *    se conserva el texto más largo.
 */
export function mergeChunks(chunks: ExtractionChunk[]): MergedExtraction {
  const questionsByNumber = new Map<number, ExtractedQuestion>();
  for (const chunk of chunks) {
    for (const q of chunk.questions) {
      const prev = questionsByNumber.get(q.number);
      if (!prev || score(q) > score(prev)) {
        questionsByNumber.set(q.number, q);
      }
    }
  }

  const contextsByKey = new Map<string, Context>();
  for (const chunk of chunks) {
    for (const c of chunk.contexts) {
      const key = c.title ? `t:${normTitle(c.title)}` : `x:${c.text.slice(0, 80)}`;
      const prev = contextsByKey.get(key);
      if (!prev || c.text.length > prev.text.length) {
        contextsByKey.set(key, c);
      }
    }
  }

  const questions = [...questionsByNumber.values()].sort((a, b) => a.number - b.number);

  // Mantén solo contextos efectivamente referenciados por alguna pregunta.
  const referenced = new Set(
    questions.map((q) => (q.contextTitle ? normTitle(q.contextTitle) : "")),
  );
  const contexts = [...contextsByKey.values()].filter((c) =>
    c.title ? referenced.has(normTitle(c.title)) : true,
  );

  return { contexts, questions };
}

function score(q: ExtractedQuestion): number {
  return q.text.length + q.options.length * 50;
}

/** Detecta huecos en la numeración (útil para avisar de preguntas perdidas). */
export function findMissingNumbers(questions: ExtractedQuestion[]): number[] {
  if (questions.length === 0) return [];
  const nums = questions.map((q) => q.number).sort((a, b) => a - b);
  const min = nums[0]!;
  const max = nums[nums.length - 1]!;
  const present = new Set(nums);
  const missing: number[] = [];
  for (let n = min; n <= max; n++) if (!present.has(n)) missing.push(n);
  return missing;
}
