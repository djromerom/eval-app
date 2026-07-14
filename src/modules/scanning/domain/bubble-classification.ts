/**
 * Reglas de detección de burbujas OMR (REQUERIMIENTOS_v2.md §3.6 y §11):
 * - Marcada:  > 60% de píxeles rellenos
 * - Vacía:    < 20% de píxeles rellenos
 * - Ambigua:  entre 20% y 60% → revisión manual
 * Lógica pura, sin dependencias: testeable sin imágenes reales.
 */
export const MARKED_THRESHOLD = 0.6;
export const EMPTY_THRESHOLD = 0.2;

export type BubbleState = "MARKED" | "EMPTY" | "AMBIGUOUS";

export type AnswerKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export interface BubbleReading {
  key: AnswerKey;
  /** Proporción de píxeles rellenos en la región de la burbuja, 0..1 */
  fillRatio: number;
}

export interface QuestionReading {
  status: "ANSWERED" | "BLANK" | "MULTIPLE" | "REVIEW";
  selectedKey: AnswerKey | null;
  /** Confianza 0..1 de la detección (distancia a los umbrales) */
  confidence: number;
}

export function classifyBubble(fillRatio: number): BubbleState {
  if (fillRatio > MARKED_THRESHOLD) return "MARKED";
  if (fillRatio < EMPTY_THRESHOLD) return "EMPTY";
  return "AMBIGUOUS";
}

/** Interpreta las 4 burbujas de una pregunta. */
export function readQuestion(bubbles: BubbleReading[]): QuestionReading {
  const marked = bubbles.filter((b) => classifyBubble(b.fillRatio) === "MARKED");
  const ambiguous = bubbles.filter((b) => classifyBubble(b.fillRatio) === "AMBIGUOUS");

  if (marked.length === 1 && ambiguous.length === 0) {
    const bubble = marked[0]!;
    return {
      status: "ANSWERED",
      selectedKey: bubble.key,
      confidence: confidenceFor(bubble.fillRatio),
    };
  }
  if (marked.length > 1) {
    // Múltiple marca → respuesta inválida (§3.6)
    return { status: "MULTIPLE", selectedKey: null, confidence: 1 };
  }
  if (ambiguous.length > 0) {
    return { status: "REVIEW", selectedKey: null, confidence: 0 };
  }
  return { status: "BLANK", selectedKey: null, confidence: 1 };
}

function confidenceFor(fillRatio: number): number {
  // Qué tan lejos está la marca del umbral: 0.6 → 0, 1.0 → 1
  return Math.min(1, (fillRatio - MARKED_THRESHOLD) / (1 - MARKED_THRESHOLD));
}
