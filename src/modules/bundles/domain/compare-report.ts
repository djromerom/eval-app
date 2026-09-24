/**
 * Reporte comparativo entre las evaluations de un bundle.
 * Ver docs/cuadernillos.md §"Sprint 3 — Reporte comparativo" y §"Sprint 4
 * — Drill-down por item/hoja".
 *
 * El reporte agrega, por evaluation del bundle:
 *   - totalQuestions: total de preguntas de la evaluation
 *   - scannedSheets: total de hojas del bundle
 *   - correctRate: media de aciertos sobre las preguntas de la evaluation,
 *     entre todas las hojas que escanearon esa pregunta.
 *   - difficulty: 1 - correctRate (más alto = más difícil).
 *
 * Y por pregunta (con numeración continua 1..N dentro del bundle):
 *   - correctRate: fracción de hojas que acertaron esa pregunta.
 *   - answeredCount: total de hojas que la respondieron (sin contar null).
 *
 * Sprint 4 añade un drill-down por hoja × item: para cada hoja del bundle,
 * correctRate por item (la evaluation de la hoja + posición). Esto es
 * posible porque StudentAnswer.bundleItemId ahora se popula al calificar.
 *
 * Preguntas inhabilitadas (sprint Preguntas inhabitadas, sep 2026): siguen
 * listadas por pregunta con `disabled: true` (la tasa se muestra como dato),
 * pero no entran en el promedio por evaluation ni en el desglose por hoja,
 * igual que no entran en la nota guardada de la hoja.
 */

export interface CompareReportItem {
  evaluationId: string;
  evaluationTitle: string;
  totalQuestions: number;
  /** Preguntas de la evaluation inhabilitadas en el cuadernillo. */
  disabledCount: number;
  scannedSheets: number;
  correctRate: number | null;
  difficulty: number | null;
}

export interface CompareReportQuestion {
  questionId: string;
  globalNumber: number;
  evaluationId: string;
  evaluationTitle: string;
  correctRate: number | null;
  answeredCount: number;
  /** Inhabilitada en el cuadernillo: no cuenta para la nota. */
  disabled: boolean;
}

export interface CompareReportSheetItem {
  sheetId: string;
  bundleItemId: string;
  correctRate: number | null;
  correctCount: number;
  questionCount: number;
}

export interface CompareReportSheetBreakdown {
  sheetId: string;
  studentName: string | null;
  studentCode: string | null;
  perItem: CompareReportSheetItem[];
}

export interface CompareReport {
  bundleId: string;
  totalQuestions: number;
  totalScannedSheets: number;
  items: CompareReportItem[];
  questions: CompareReportQuestion[];
  /** Sprint 4: solo presente si los StudentAnswer tienen bundleItemId
   *  poblado. Para hojas legacy (single-evaluation) viene vacío. */
  perSheetBreakdown: CompareReportSheetBreakdown[];
}

export interface CompareReportQuestionInput {
  id: string;
  evaluationId: string;
  evaluationTitle: string;
  /** Sprint 4: opcional para hojas legacy. Si está y los StudentAnswer
   *  también lo traen, habilita perSheetBreakdown. */
  bundleItemId?: string | null;
}

export interface CompareReportItemInput {
  bundleItemId: string;
  evaluationId: string;
  evaluationTitle: string;
  totalQuestions: number;
}

export interface CompareReportInput {
  bundleId: string;
  items: CompareReportItemInput[];
  questions: CompareReportQuestionInput[];
  /** totalScannedSheets: cantidad de hojas escaneadas del bundle. */
  totalScannedSheets: number;
  /**
   * Para cada questionId, una lista de `isCorrect` (uno por hoja que la
   * respondió). null = respondida pero sin veredicto claro (REVIEW).
   * Si una hoja no respondió una pregunta, no aparece en la lista.
   */
  answersByQuestion: Map<string, Array<boolean | null>>;
  /**
   * Sprint 4: para cada sheetId, una lista de respuestas con (questionId,
   * bundleItemId, isCorrect). Si está vacío, perSheetBreakdown queda [] y
   * los reportes existentes (per-item, per-question) siguen funcionando.
   */
  answersBySheet?: Map<
    string,
    Array<{ questionId: string; bundleItemId: string | null; isCorrect: boolean | null }>
  >;
  /** Sprint 4: nombre/código legible de cada hoja. Opcional. */
  sheetLabels?: Map<string, { name: string | null; code: string | null }>;
  /** Preguntas inhabilitadas del cuadernillo. Opcional: sin él, ninguna. */
  disabledQuestionIds?: ReadonlySet<string>;
}

/** Compute el reporte comparativo. O(questions + totalAnswers). */
export function computeCompareReport(input: CompareReportInput): CompareReport {
  const {
    bundleId,
    items,
    questions,
    totalScannedSheets,
    answersByQuestion,
    answersBySheet,
    sheetLabels,
    disabledQuestionIds,
  } = input;
  const isDisabled = (questionId: string) => disabledQuestionIds?.has(questionId) ?? false;

  // 1. correctRate por pregunta.
  const perQuestion: CompareReportQuestion[] = questions.map((q, idx) => {
    const verdicts = answersByQuestion.get(q.id) ?? [];
    const answered = verdicts.filter((v): v is boolean => v !== null);
    const correct = answered.filter((v) => v === true).length;
    return {
      questionId: q.id,
      globalNumber: idx + 1,
      evaluationId: q.evaluationId,
      evaluationTitle: q.evaluationTitle,
      correctRate: answered.length > 0 ? correct / answered.length : null,
      answeredCount: answered.length,
      disabled: isDisabled(q.id),
    };
  });

  // 2. Stats por evaluation: agrupamos preguntas por evaluation y promediamos.
  const itemReports: CompareReportItem[] = items.map((it) => {
    const qs = perQuestion.filter((q) => q.evaluationId === it.evaluationId);
    const withRate = qs.filter((q) => !q.disabled && q.correctRate !== null) as Array<
      CompareReportQuestion & { correctRate: number }
    >;
    const correctRate = withRate.length > 0 ? mean(withRate.map((q) => q.correctRate)) : null;
    const difficulty = correctRate !== null ? 1 - correctRate : null;
    return {
      evaluationId: it.evaluationId,
      evaluationTitle: it.evaluationTitle,
      totalQuestions: it.totalQuestions,
      disabledCount: qs.filter((q) => q.disabled).length,
      scannedSheets: totalScannedSheets,
      correctRate,
      difficulty,
    };
  });

  // 3. Sprint 4: drill-down por hoja × item. Solo si hay datos.
  const perSheetBreakdown: CompareReportSheetBreakdown[] = [];
  if (answersBySheet && answersBySheet.size > 0) {
    for (const [sheetId, answers] of answersBySheet) {
      // agrupa por bundleItemId, contando correct/answered
      const buckets = new Map<string, { correct: number; answered: number; total: number }>();
      for (const ans of answers) {
        if (!ans.bundleItemId) continue; // hoja legacy sin item → skip
        if (isDisabled(ans.questionId)) continue; // inhabilitada: no cuenta
        const b = buckets.get(ans.bundleItemId) ?? { correct: 0, answered: 0, total: 0 };
        b.total++;
        if (ans.isCorrect !== null) {
          b.answered++;
          if (ans.isCorrect) b.correct++;
        }
        buckets.set(ans.bundleItemId, b);
      }
      const perItem: CompareReportSheetItem[] = [];
      for (const [bundleItemId, b] of buckets) {
        perItem.push({
          sheetId,
          bundleItemId,
          correctRate: b.answered > 0 ? b.correct / b.answered : null,
          correctCount: b.correct,
          questionCount: b.answered,
        });
      }
      perSheetBreakdown.push({
        sheetId,
        studentName: sheetLabels?.get(sheetId)?.name ?? null,
        studentCode: sheetLabels?.get(sheetId)?.code ?? null,
        perItem,
      });
    }
    // Ordena por código de estudiante para presentación estable.
    perSheetBreakdown.sort((a, b) =>
      (a.studentCode ?? a.sheetId).localeCompare(b.studentCode ?? b.sheetId),
    );
  }

  return {
    bundleId,
    totalQuestions: questions.length,
    totalScannedSheets,
    items: itemReports,
    questions: perQuestion,
    perSheetBreakdown,
  };
}

function mean(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0) / xs.length;
}
