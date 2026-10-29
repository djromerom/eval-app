import { describe, expect, it } from "vitest";
import { computeCompareReport } from "@/modules/bundles/domain/compare-report";

describe("computeCompareReport", () => {
  const items = [
    {
      bundleItemId: "bi-bio",
      evaluationId: "ev-bio",
      evaluationTitle: "Biología",
      totalQuestions: 4,
    },
    {
      bundleItemId: "bi-fis",
      evaluationId: "ev-fis",
      evaluationTitle: "Física",
      totalQuestions: 4,
    },
  ];

  const questions = [
    { id: "q1", bundleItemId: "bi-bio", evaluationId: "ev-bio", evaluationTitle: "Biología" },
    { id: "q2", bundleItemId: "bi-bio", evaluationId: "ev-bio", evaluationTitle: "Biología" },
    { id: "q3", bundleItemId: "bi-bio", evaluationId: "ev-bio", evaluationTitle: "Biología" },
    { id: "q4", bundleItemId: "bi-bio", evaluationId: "ev-bio", evaluationTitle: "Biología" },
    { id: "q5", bundleItemId: "bi-fis", evaluationId: "ev-fis", evaluationTitle: "Física" },
    { id: "q6", bundleItemId: "bi-fis", evaluationId: "ev-fis", evaluationTitle: "Física" },
    { id: "q7", bundleItemId: "bi-fis", evaluationId: "ev-fis", evaluationTitle: "Física" },
    { id: "q8", bundleItemId: "bi-fis", evaluationId: "ev-fis", evaluationTitle: "Física" },
  ];

  it("devuelve rates null si nadie escaneó el bundle", () => {
    const report = computeCompareReport({
      bundleId: "b1",
      items,
      questions,
      totalScannedSheets: 0,
      answersByQuestion: new Map(),
    });
    expect(report.totalScannedSheets).toBe(0);
    expect(report.totalQuestions).toBe(8);
    expect(report.items).toHaveLength(2);
    expect(report.items[0]!.correctRate).toBeNull();
    expect(report.items[0]!.difficulty).toBeNull();
    for (const q of report.questions) {
      expect(q.correctRate).toBeNull();
      expect(q.answeredCount).toBe(0);
    }
    // Sin datos, sin breakdown
    expect(report.perSheetBreakdown).toEqual([]);
  });

  it("computa correctRate por pregunta y promedio por evaluation", () => {
    // Hoja 1: acierta q1,q2,q5,q6, falla q3,q4,q7,q8
    // Hoja 2: acierta q1,q3,q5,q7, falla q2,q4,q6,q8
    // Hoja 3: acierta q1,q4,q5,q8, falla q2,q3,q6,q7
    const answers = new Map<string, Array<boolean | null>>([
      ["q1", [true, true, true]], // 3/3 = 1.00
      ["q2", [false, false, false]], // 0/3 = 0.00
      ["q3", [false, true, false]], // 1/3 = 0.33
      ["q4", [false, false, true]], // 1/3 = 0.33
      ["q5", [true, true, true]], // 1.00
      ["q6", [true, false, false]], // 0.33
      ["q7", [false, true, false]], // 0.33
      ["q8", [false, false, true]], // 0.33
    ]);
    const report = computeCompareReport({
      bundleId: "b1",
      items,
      questions,
      totalScannedSheets: 3,
      answersByQuestion: answers,
    });
    expect(report.totalScannedSheets).toBe(3);
    expect(report.questions[0]!.correctRate).toBe(1); // q1
    expect(report.questions[1]!.correctRate).toBe(0); // q2
    expect(report.questions[2]!.correctRate).toBeCloseTo(1 / 3); // q3
    // Biología (q1..q4): (1 + 0 + 0.33 + 0.33) / 4 ≈ 0.417
    expect(report.items[0]!.correctRate!).toBeCloseTo((1 + 0 + 1 / 3 + 1 / 3) / 4);
    // Física (q5..q8): (1 + 0.33 + 0.33 + 0.33) / 4 ≈ 0.5
    expect(report.items[1]!.correctRate!).toBeCloseTo((1 + 1 / 3 + 1 / 3 + 1 / 3) / 4);
    // difficulty = 1 - correctRate
    expect(report.items[0]!.difficulty!).toBeCloseTo(1 - report.items[0]!.correctRate!);
    expect(report.items[1]!.difficulty!).toBeCloseTo(1 - report.items[1]!.correctRate!);
  });

  it("ignora respuestas null (REVIEW / sin veredicto) en el cómputo", () => {
    const answers = new Map<string, Array<boolean | null>>([
      ["q1", [true, null]], // respondido por 1 hoja (con acierto)
      ["q2", [null, null]], // nadie con veredicto claro
    ]);
    const report = computeCompareReport({
      bundleId: "b1",
      items: [
        {
          bundleItemId: "bi-ev",
          evaluationId: "ev",
          evaluationTitle: "Ev",
          totalQuestions: 2,
        },
      ],
      questions: [
        {
          id: "q1",
          bundleItemId: "bi-ev",
          evaluationId: "ev",
          evaluationTitle: "Ev",
        },
        {
          id: "q2",
          bundleItemId: "bi-ev",
          evaluationId: "ev",
          evaluationTitle: "Ev",
        },
      ],
      totalScannedSheets: 2,
      answersByQuestion: answers,
    });
    expect(report.questions[0]!.correctRate).toBe(1); // 1/1
    expect(report.questions[0]!.answeredCount).toBe(1);
    expect(report.questions[1]!.correctRate).toBeNull(); // nadie con veredicto
    expect(report.questions[1]!.answeredCount).toBe(0);
  });

  it("Sprint 4: drill-down por hoja × item cuando hay answersBySheet con bundleItemId", () => {
    // 2 estudiantes. stud1 tiene q1,q2 (bi-bio) acierta 1; y q5,q6 (bi-fis) acierta 2.
    // stud2 tiene q1,q2 (bi-bio) acierta 0; y q5,q6 (bi-fis) acierta 1.
    const answersBySheet = new Map<
      string,
      Array<{ questionId: string; bundleItemId: string | null; isCorrect: boolean | null }>
    >([
      [
        "sh1",
        [
          { questionId: "q1", bundleItemId: "bi-bio", isCorrect: true },
          { questionId: "q2", bundleItemId: "bi-bio", isCorrect: false },
          { questionId: "q5", bundleItemId: "bi-fis", isCorrect: true },
          { questionId: "q6", bundleItemId: "bi-fis", isCorrect: true },
        ],
      ],
      [
        "sh2",
        [
          { questionId: "q1", bundleItemId: "bi-bio", isCorrect: false },
          { questionId: "q2", bundleItemId: "bi-bio", isCorrect: false },
          { questionId: "q5", bundleItemId: "bi-fis", isCorrect: true },
          { questionId: "q6", bundleItemId: "bi-fis", isCorrect: false },
        ],
      ],
    ]);
    const sheetLabels = new Map<string, { name: string | null; code: string | null }>([
      ["sh1", { name: "Ana Pérez", code: "S-001" }],
      ["sh2", { name: "Beto Díaz", code: "S-002" }],
    ]);
    const report = computeCompareReport({
      bundleId: "b1",
      items,
      questions,
      totalScannedSheets: 2,
      answersByQuestion: new Map(),
      answersBySheet,
      sheetLabels,
    });
    expect(report.perSheetBreakdown).toHaveLength(2);
    // Ordenado por código: sh1 (S-001) primero.
    expect(report.perSheetBreakdown[0]!.sheetId).toBe("sh1");
    expect(report.perSheetBreakdown[0]!.studentName).toBe("Ana Pérez");
    expect(report.perSheetBreakdown[0]!.perItem).toHaveLength(2);
    // bi-bio: 1/2 = 0.5
    const sh1Bio = report.perSheetBreakdown[0]!.perItem.find((p) => p.bundleItemId === "bi-bio")!;
    expect(sh1Bio.correctRate).toBeCloseTo(0.5);
    expect(sh1Bio.correctCount).toBe(1);
    expect(sh1Bio.questionCount).toBe(2);
    // bi-fis: 2/2 = 1.0
    const sh1Fis = report.perSheetBreakdown[0]!.perItem.find((p) => p.bundleItemId === "bi-fis")!;
    expect(sh1Fis.correctRate).toBe(1);
    // sh2 (Beto): bi-bio 0/2, bi-fis 1/2
    expect(report.perSheetBreakdown[1]!.sheetId).toBe("sh2");
    const sh2Bio = report.perSheetBreakdown[1]!.perItem.find((p) => p.bundleItemId === "bi-bio")!;
    expect(sh2Bio.correctRate).toBe(0);
    const sh2Fis = report.perSheetBreakdown[1]!.perItem.find((p) => p.bundleItemId === "bi-fis")!;
    expect(sh2Fis.correctRate).toBeCloseTo(0.5);
  });

  it("Sprint 4: salta respuestas sin bundleItemId (hojas legacy) en el breakdown", () => {
    const answersBySheet = new Map<
      string,
      Array<{ questionId: string; bundleItemId: string | null; isCorrect: boolean | null }>
    >([
      [
        "sh1",
        [
          { questionId: "q1", bundleItemId: null, isCorrect: true }, // legacy
          { questionId: "q1", bundleItemId: "bi-bio", isCorrect: false }, // válido
        ],
      ],
    ]);
    const report = computeCompareReport({
      bundleId: "b1",
      items,
      questions,
      totalScannedSheets: 1,
      answersByQuestion: new Map(),
      answersBySheet,
    });
    expect(report.perSheetBreakdown).toHaveLength(1);
    expect(report.perSheetBreakdown[0]!.perItem).toHaveLength(1);
    // Solo quedó bi-bio
    expect(report.perSheetBreakdown[0]!.perItem[0]!.bundleItemId).toBe("bi-bio");
  });

  describe("preguntas inhabilitadas del cuadernillo", () => {
    // q1 y q2 de Biología: q1 siempre acertada, q2 siempre fallada.
    // Con q2 inhabilitada, la tasa de Biología sube de 50% a 100%.
    const answers = new Map<string, Array<boolean | null>>([
      ["q1", [true, true]],
      ["q2", [false, false]],
      ["q5", [true, false]],
    ]);
    const answersBySheet = new Map<
      string,
      Array<{ questionId: string; bundleItemId: string | null; isCorrect: boolean | null }>
    >([
      [
        "sh-1",
        [
          { questionId: "q1", bundleItemId: "bi-bio", isCorrect: true },
          { questionId: "q2", bundleItemId: "bi-bio", isCorrect: false },
          { questionId: "q5", bundleItemId: "bi-fis", isCorrect: true },
        ],
      ],
    ]);
    const base = {
      bundleId: "b1",
      items,
      questions: questions.filter((q) => ["q1", "q2", "q5"].includes(q.id)),
      totalScannedSheets: 2,
      answersByQuestion: answers,
      answersBySheet,
    };

    it("sin set de inhabilitadas se comporta igual que antes", () => {
      const report = computeCompareReport(base);
      expect(report.items[0]!.correctRate).toBeCloseTo(0.5);
      expect(report.items[0]!.disabledCount).toBe(0);
      expect(report.questions.every((q) => q.disabled === false)).toBe(true);
    });

    it("marca la pregunta como disabled pero conserva su tasa", () => {
      const report = computeCompareReport({ ...base, disabledQuestionIds: new Set(["q2"]) });
      const q2 = report.questions.find((q) => q.questionId === "q2")!;
      expect(q2.disabled).toBe(true);
      expect(q2.correctRate).toBe(0);
      expect(report.questions.find((q) => q.questionId === "q1")!.disabled).toBe(false);
    });

    it("excluye la inhabilitada del promedio de su formulación", () => {
      const report = computeCompareReport({ ...base, disabledQuestionIds: new Set(["q2"]) });
      const bio = report.items.find((i) => i.evaluationId === "ev-bio")!;
      expect(bio.correctRate).toBeCloseTo(1);
      expect(bio.difficulty).toBeCloseTo(0);
      expect(bio.disabledCount).toBe(1);
      // Física no se ve afectada.
      expect(report.items.find((i) => i.evaluationId === "ev-fis")!.disabledCount).toBe(0);
    });

    it("excluye la inhabilitada del desglose por estudiante", () => {
      const report = computeCompareReport({ ...base, disabledQuestionIds: new Set(["q2"]) });
      const bio = report.perSheetBreakdown[0]!.perItem.find((p) => p.bundleItemId === "bi-bio")!;
      expect(bio.correctCount).toBe(1);
      expect(bio.questionCount).toBe(1);
      expect(bio.correctRate).toBeCloseTo(1);
    });
  });
});
