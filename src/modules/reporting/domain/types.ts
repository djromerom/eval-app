export interface EvaluationStatistics {
  evaluationId: string;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
}

export interface ItemAnalysis {
  questionId: string;
  questionNumber: number;
  /** Proporción de aciertos 0..1 */
  difficultyIndex: number;
  /** Correlación ítem-total (discriminación) */
  discriminationIndex: number;
  /** Porcentaje que eligió cada opción */
  optionDistribution: Record<"A" | "B" | "C" | "D" | "BLANK", number>;
}
