import { vi, describe, expect, it, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.AUTH_SECRET = "test-auth-secret-1234567890123";
  process.env.QR_SIGNING_SECRET = "test-secret-at-least-16-chars!!";
});

// `grid.json` se reescribe vía best-effort. Mockeamos el storage para que
// no toque disco y para asercionar la forma del JSON que se escribe.
// `vi.mock` se eleva por encima de los imports — el estado compartido
// entre el factory y los tests tiene que vivir dentro de `vi.hoisted`.
const { writes, reads } = vi.hoisted(() => {
  const writes: { path: string; content: string }[] = [];
  const reads = new Map<string, string>();
  return { writes, reads };
});

vi.mock("@/shared/infrastructure/storage/local-storage", () => ({
  localStorage: {
    async read(path: string) {
      const v = reads.get(path);
      if (v === undefined) throw new Error(`not found: ${path}`);
      return Buffer.from(v, "utf-8");
    },
    async save(path: string, buf: Buffer) {
      writes.push({ path, content: buf.toString("utf-8") });
    },
  },
}));

import { CorrectAnswerSheetAnswers } from "@/modules/scanning/application/correct-answer-sheet-answers";
import type {
  AnswerSheet,
  AnswerSheetStatus,
  ScanBatch,
  ScanningRepository,
  StudentAnswerRecord,
  StudentAnswersReader,
} from "@/modules/scanning/domain/answer-sheet";
import type { EvaluationQuestionsProvider } from "@/modules/scanning/application/process-answer-sheet";

const INST = "inst-1";
const BATCH = "batch-1";
const SHEET_A = "sheet-a";
const SHEET_B = "sheet-b";

function makeActor() {
  return {
    userId: "u-1",
    institutionId: INST,
    role: "TEACHER" as const,
    roles: ["TEACHER" as const],
  };
}

function makeSheet(overrides: Partial<AnswerSheet> = {}): AnswerSheet {
  return {
    id: SHEET_A,
    institutionId: INST,
    evaluationId: "eval-1",
    bundleId: null,
    scanBatchId: BATCH,
    studentId: null,
    studentName: null,
    studentCode: null,
    qrContent: "",
    qrSignature: "",
    scannedImage: null,
    status: "GRADED",
    score: 0,
    totalCorrect: 0,
    totalQuestions: 4,
    ...overrides,
  };
}

function makeRecord(qid: string, ans: string, isCorrect: boolean): StudentAnswerRecord {
  return {
    questionId: qid,
    bundleItemId: null,
    selectedKey: ans as StudentAnswerRecord["selectedKey"],
    isCorrect,
    isAmbiguous: false,
    confidence: 0.9,
    fillRatio: 0.5,
    cells: undefined,
  };
}

/** `q1..q4` con correctas B, A, D, C. Hoja de evaluación (no bundle). */
const correctAnswers = [
  { id: "q1", number: 1, correctAnswer: "B" as const, optionsLength: 4 },
  { id: "q2", number: 2, correctAnswer: "A" as const, optionsLength: 4 },
  { id: "q3", number: 3, correctAnswer: "D" as const, optionsLength: 4 },
  { id: "q4", number: 4, correctAnswer: "C" as const, optionsLength: 4 },
];

function makeQuestionsProvider(opts: {
  withDisabled?: string[];
} = {}): EvaluationQuestionsProvider {
  return {
    async getCorrectAnswers(_inst, _evalId) {
      return correctAnswers;
    },
    async getCorrectAnswersForBundle(_inst, _bid) {
      return correctAnswers.map((q) => ({
        ...q,
        bundleItemId: "bi-1",
        disabled: opts.withDisabled?.includes(q.id) ?? false,
      }));
    },
  };
}

function makeInMemoryRepo(initial: {
  batch?: ScanBatch | null;
  sheets?: Map<string, AnswerSheet>;
  answers?: Map<string, StudentAnswerRecord[]>;
  existingGridThr?: number | null;
} = {}) {
  const batch = initial.batch ?? {
    id: BATCH,
    institutionId: INST,
    evaluationId: "eval-1",
    bundleId: null,
    status: "COMPLETED" as const,
    totalSheets: 2,
    processedSheets: 2,
  };
  const sheets = initial.sheets ?? new Map<string, AnswerSheet>();
  const answers = initial.answers ?? new Map<string, StudentAnswerRecord[]>();
  let updatedSheetStatus:
    | {
        sheetId: string;
        status: AnswerSheetStatus;
        data?: { score?: number; totalCorrect?: number; totalQuestions?: number };
      }
    | undefined;

  const repo: ScanningRepository = {
    async getScanBatch(_i, id) {
      return id === batch.id ? batch : null;
    },
    async getAnswerSheet(_i, id) {
      return sheets.get(id) ?? null;
    },
    async updateSheetStatus(sheetId, status, data) {
      updatedSheetStatus = { sheetId, status, data };
    },
    async saveAnswers(sheetId, ans) {
      answers.set(sheetId, ans);
    },
    async saveDecodedQr() {
      return { studentId: null, duplicada: false };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async updateBatchProgress() {},
  };

  const reader: StudentAnswersReader = {
    async listStudentAnswersForSheet(sheetId) {
      return answers.get(sheetId) ?? [];
    },
  };

  if (initial.existingGridThr !== undefined && initial.existingGridThr !== null) {
    reads.set(
      `scans/${BATCH}/sheet_${SHEET_A}_grid.json`,
      JSON.stringify({ thr: initial.existingGridThr }),
    );
  }

  return {
    repo,
    reader,
    actor: makeActor(),
    questionsProvider: makeQuestionsProvider(),
    sheets,
    answers,
    get updatedSheetStatus() {
      return updatedSheetStatus;
    },
    /** Helper para sembrar respuestas detectadas por el worker. */
    seedAnswers(sheetId: string, recs: StudentAnswerRecord[]) {
      answers.set(sheetId, recs);
      if (!sheets.has(sheetId)) {
        sheets.set(sheetId, makeSheet({ id: sheetId }));
      }
    },
  };
}

beforeEach(() => {
  writes.length = 0;
  reads.clear();
});

describe("CorrectAnswerSheetAnswers", () => {
  it("happy path: aplica correcciones, recalcula score, persiste y reescribe grid.json", async () => {
    const ctx = makeInMemoryRepo({ existingGridThr: 0.42 });
    // Hoja A: detectadas q1=B (✓), q2=C (✗), q3=BLANCO (✗), q4=A (✗).
    // El worker habría dado score 1/4. Corregimos: q2→A (✓), q4→C (✓).
    // Score esperado: 3/4.
    ctx.seedAnswers(SHEET_A, [
      makeRecord("q1", "B", true),
      makeRecord("q2", "C", false),
      makeRecord("q3", "BLANCO", false),
      makeRecord("q4", "A", false),
    ]);

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [
        {
          sheetId: SHEET_A,
          corrections: [
            { posicion: 2, selectedKey: "A" },
            { posicion: 4, selectedKey: "C" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updatedSheets).toEqual([
      { sheetId: SHEET_A, score: 3, totalCorrect: 3, totalQuestions: 4, changed: 2 },
    ]);

    // StudentAnswer actualizado
    const persisted = ctx.answers.get(SHEET_A)!;
    expect(persisted[1]!.selectedKey).toBe("A");
    expect(persisted[1]!.isCorrect).toBe(true);
    expect(persisted[1]!.isAmbiguous).toBe(false);
    expect(persisted[3]!.selectedKey).toBe("C");
    expect(persisted[3]!.isCorrect).toBe(true);
    // q1 sin tocar
    expect(persisted[0]!.selectedKey).toBe("B");
    expect(persisted[0]!.isCorrect).toBe(true);

    // updateSheetStatus con score nuevo y status preservado
    expect(ctx.updatedSheetStatus).toEqual({
      sheetId: SHEET_A,
      status: "GRADED",
      data: { score: 3, totalCorrect: 3, totalQuestions: 4 },
    });

    // grid.json reescrito con thr preservado y nuevas respuestas
    expect(writes).toHaveLength(1);
    const grid = JSON.parse(writes[0]!.content);
    expect(grid.thr).toBe(0.42);
    expect(grid.answers).toEqual([
      { n: 1, ans: "B" },
      { n: 2, ans: "A" },
      { n: 3, ans: "BLANCO" },
      { n: 4, ans: "C" },
    ]);
  });

  it("preguntas inhabitadas no cuentan para el score aunque se corrijan", async () => {
    const ctx = makeInMemoryRepo();
    // Bundle con q3 inhabilitada. Detectadas: q1=B(✓), q2=A(✓), q3=A(✗),
    // q4=C(✓). Score inicial del worker habría sido 3/3 (q3 no cuenta).
    // Corregimos q3→D (sigue ✗ y sigue sin contar).
    ctx.seedAnswers(SHEET_A, [
      makeRecord("q1", "B", true),
      makeRecord("q2", "A", true),
      makeRecord("q3", "A", false),
      makeRecord("q4", "C", true),
    ]);
    const bundleSheet = makeSheet({
      id: SHEET_A,
      bundleId: "bundle-1",
      evaluationId: null,
      status: "GRADED",
    });
    ctx.sheets.set(SHEET_A, bundleSheet);

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      makeQuestionsProvider({ withDisabled: ["q3"] }),
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [
        { sheetId: SHEET_A, corrections: [{ posicion: 3, selectedKey: "D" }] },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // totalCorrect=3, totalQuestions=3 (q3 excluida)
    expect(result.value.updatedSheets[0]).toMatchObject({
      totalCorrect: 3,
      totalQuestions: 3,
    });
    // Pero la fila q3 SÍ se actualizó en StudentAnswer (para el reporte)
    const persisted = ctx.answers.get(SHEET_A)!;
    expect(persisted[2]!.selectedKey).toBe("D");
  });

  it("rechaza con SHEET_PROCESSING si la hoja que se corrige está en PROCESSING", async () => {
    const ctx = makeInMemoryRepo();
    ctx.seedAnswers(SHEET_A, [makeRecord("q1", "B", true)]);
    ctx.seedAnswers(SHEET_B, [makeRecord("q1", "B", true)]);
    ctx.sheets.set(SHEET_B, makeSheet({ id: SHEET_B, status: "PROCESSING" }));

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [{ sheetId: SHEET_B, corrections: [{ posicion: 1, selectedKey: "A" }] }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SHEET_PROCESSING");
    // Ninguna escritura: ni en SHEET_A ni en SHEET_B
    expect(ctx.answers.get(SHEET_B)?.[0]!.selectedKey).toBe("B");
  });

  it("rechaza con POSITION_OUT_OF_RANGE si alguna posicion se pasa del total", async () => {
    const ctx = makeInMemoryRepo();
    ctx.seedAnswers(SHEET_A, [
      makeRecord("q1", "B", true),
      makeRecord("q2", "A", true),
    ]);

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [
        { sheetId: SHEET_A, corrections: [{ posicion: 5, selectedKey: "A" }] },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("POSITION_OUT_OF_RANGE");
    expect(ctx.updatedSheetStatus).toBeUndefined();
  });

  it("rechaza con INVALID_KEY si selectedKey no es A-H", async () => {
    const ctx = makeInMemoryRepo();
    ctx.seedAnswers(SHEET_A, [makeRecord("q1", "B", true)]);

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    // Forzamos el tipo porque el compilador lo阻止 — es exactamente el caso
    // que queremos probar (cliente envía basura).
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [
        {
          sheetId: SHEET_A,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          corrections: [{ posicion: 1, selectedKey: "Z" as any }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_KEY");
  });

  it("no escribe nada si el input viene sin patches", async () => {
    const ctx = makeInMemoryRepo();
    ctx.seedAnswers(SHEET_A, [makeRecord("q1", "B", true)]);

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updatedSheets).toEqual([]);
    expect(ctx.updatedSheetStatus).toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  it("rechaza con BATCH_NOT_FOUND si el lote no existe", async () => {
    const ctx = makeInMemoryRepo();

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      // Batch id que no matchea con el sembrado → getScanBatch devuelve null.
      batchId: "batch-inexistente",
      patches: [{ sheetId: SHEET_A, corrections: [{ posicion: 1, selectedKey: "A" }] }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BATCH_NOT_FOUND");
  });

  it("rechaza con SHEET_NOT_IN_BATCH si la hoja existe pero no es del batch", async () => {
    const ctx = makeInMemoryRepo();
    ctx.seedAnswers(SHEET_A, [makeRecord("q1", "B", true)]);
    ctx.sheets.set(
      SHEET_A,
      makeSheet({ id: SHEET_A, scanBatchId: "otro-batch" }),
    );

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [{ sheetId: SHEET_A, corrections: [{ posicion: 1, selectedKey: "A" }] }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SHEET_NOT_IN_BATCH");
  });

  it("procesa varias hojas en el mismo batch y devuelve todas las actualizadas", async () => {
    const ctx = makeInMemoryRepo();
    ctx.seedAnswers(SHEET_A, [
      makeRecord("q1", "B", true),
      makeRecord("q2", "C", false),
    ]);
    ctx.seedAnswers(SHEET_B, [
      makeRecord("q1", "C", false),
      makeRecord("q2", "A", true),
    ]);

    const useCase = new CorrectAnswerSheetAnswers(
      ctx.repo,
      ctx.reader,
      ctx.questionsProvider,
    );
    const result = await useCase.execute({
      actor: ctx.actor,
      batchId: BATCH,
      patches: [
        { sheetId: SHEET_A, corrections: [{ posicion: 2, selectedKey: "A" }] },
        { sheetId: SHEET_B, corrections: [{ posicion: 1, selectedKey: "B" }] },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.updatedSheets).toEqual([
      { sheetId: SHEET_A, score: 2, totalCorrect: 2, totalQuestions: 2, changed: 1 },
      { sheetId: SHEET_B, score: 2, totalCorrect: 2, totalQuestions: 2, changed: 1 },
    ]);
    // grid.json reescrito para AMBAS hojas
    expect(writes.map((w) => w.path).sort()).toEqual([
      `scans/${BATCH}/sheet_${SHEET_A}_grid.json`,
      `scans/${BATCH}/sheet_${SHEET_B}_grid.json`,
    ]);
  });
});
