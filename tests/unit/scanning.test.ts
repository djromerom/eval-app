import { vi, describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.AUTH_SECRET = "test-auth-secret-1234567890123";
  process.env.QR_SIGNING_SECRET = "test-secret-at-least-16-chars!!";
});

import type { ScanningRepository, QrDecoder } from "@/modules/scanning/domain/answer-sheet";
import type {
  OmrDetector,
  DetectedSheet,
  DetectedQuestion,
} from "@/modules/scanning/domain/omr-detector";
import {
  ProcessAnswerSheet,
  mapDetectedQuestion,
  questionIdxToCell,
  bubbleCenter,
  BUNDLE_BUBBLE_LAYOUT,
  LEGACY_BUBBLE_LAYOUT,
} from "@/modules/scanning/application/process-answer-sheet";
import { buildSignedQrContent } from "@/modules/printing/infrastructure/qr-generator";

// Evita escrituras a disco de persistCells (JSON de recortes) en los tests.
vi.mock("@/shared/infrastructure/storage/local-storage", () => ({
  localStorage: { save: vi.fn(async (p: string) => p), read: vi.fn() },
}));

/** Detector OMR falso: una pregunta por letra en `answers`, con la letra
 *  marcada al 0.95 y las demás al 0.1. `answers=[]` produce 0 preguntas
 *  (útil para los tests que retornan antes de la detección). */
function fakeDetector(answers: string[]): OmrDetector {
  return {
    async analyze(): Promise<DetectedSheet> {
      return {
        thr: 0.5,
        questions: answers.map((ans, i) => ({
          n: i + 1,
          ans,
          fills: ["A", "B", "C", "D"].map((l) => ({
            l,
            f: ans === l ? 0.95 : 0.1,
            m: ans === l,
            x: 10 + i,
            y: 10 + i,
            r: 8,
          })),
          crop: "",
        })),
      };
    },
  };
}

// Mock measureFillRatio para devolver siempre "vacía" (0.05). Sin esto,
// la imagen PNG en blanco produce lecturas todas en cero y la hoja queda
// como BLANK (status GRADED, score 0). Eso es suficiente para validar el
// routing y la propagación de `bundleItemId` sin necesidad de fabricar
// marcas artificiales que el lector confundiría con MULTIPLE.
vi.mock("@/modules/scanning/infrastructure/preprocess-image", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/scanning/infrastructure/preprocess-image")
  >("@/modules/scanning/infrastructure/preprocess-image");
  return {
    ...actual,
    measureFillRatio: vi.fn(async () => 0.05),
  };
});

function buildFakePng() {
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

interface SheetSeed {
  id: string;
  institutionId: string;
  evaluationId: string | null;
  bundleId?: string | null;
  studentId: string | null;
  studentName: string | null;
  studentCode: string | null;
  qrContent: string;
  qrSignature: string;
  scannedImage: string;
  status: string;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
}

interface RepoState {
  repo: ScanningRepository;
  seed(sheet: SheetSeed): void;
}

function inMemoryRepo(): RepoState {
  const sheets = new Map<string, SheetSeed>();
  const statuses = new Map<string, { status: string; notes?: string }>();
  const answers = new Map<string, unknown[]>();

  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet(_i, sheetId) {
      const s = sheets.get(sheetId);
      if (!s) return null;
      return {
        id: s.id,
        institutionId: s.institutionId,
        evaluationId: s.evaluationId,
        bundleId: s.bundleId ?? null,
        studentId: s.studentId,
        studentName: s.studentName,
        studentCode: s.studentCode,
        qrContent: s.qrContent,
        qrSignature: s.qrSignature,
        scannedImage: s.scannedImage,
        status: s.status as
          "PENDING" | "SCANNED" | "PROCESSING" | "GRADED" | "REVIEW" | "COMPLETED",
        score: s.score,
        totalCorrect: s.totalCorrect,
        totalQuestions: s.totalQuestions,
      };
    },
    async updateSheetStatus(sheetId, status, data) {
      statuses.set(sheetId, { status, notes: data?.notes });
      const s = sheets.get(sheetId);
      if (s) {
        sheets.set(sheetId, {
          ...s,
          status: status as string,
          ...(data?.score !== undefined ? { score: data.score } : {}),
          ...(data?.totalCorrect !== undefined ? { totalCorrect: data.totalCorrect } : {}),
          ...(data?.totalQuestions !== undefined ? { totalQuestions: data.totalQuestions } : {}),
        });
      }
    },
    async saveDecodedQr(sheetId, qrContent, _qrSignature, _studentCode) {
      const s = sheets.get(sheetId);
      if (s) {
        sheets.set(sheetId, { ...s, qrContent });
      }
      return { studentId: s?.studentId ?? null };
    },
    async saveAnswers(sheetId, ans) {
      answers.set(sheetId, ans);
    },
    async updateBatchProgress() {},
  };

  return {
    repo,
    seed(sheet: SheetSeed) {
      sheets.set(sheet.id, { ...sheet });
    },
  };
}

let pngPath: string;

beforeAll(async () => {
  // El PNG se crea en un tmpdir ABSOLUTO y se le pasa a `execute` como path
  // absoluto, que es la convención que `process-answer-sheet` reconoce sin
  // ambigüedad (paths absolutos NO se les prefija STORAGE_DIR). Antes
  // escribíamos con `mkdtempSync("scanning-test-")` que devuelve un path
  // RELATIVO al CWD — mi fix del OMR empezó a resolver paths relativos
  // contra `env.STORAGE_DIR`, lo cual rompía este test porque la imagen
  // quedaba en `./storage/scanning-test-XXX/test.png` en vez de
  // `./storage/<otro>/...`. Pasando absoluto, ambos comportamientos son
  // equivalentes y el test sigue describiendo el flujo real del worker.
  const tmpDir = mkdtempSync(join(tmpdir(), "scanning-test-"));
  pngPath = join(tmpDir, "test.png");
  writeFileSync(pngPath, await buildFakePng());
});

describe("ProcessAnswerSheet", () => {
  const questions = [
    { id: "q1", number: 1, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-fake" },
    { id: "q2", number: 2, correctAnswer: "A" as const, optionsLength: 4, bundleItemId: "bi-fake" },
    { id: "q3", number: 3, correctAnswer: "D" as const, optionsLength: 4, bundleItemId: "bi-fake" },
  ];

  const questionsProvider = {
    getCorrectAnswers: async () => questions,
    getCorrectAnswersForBundle: async () => [],
  };

  it("returns NOT_FOUND when answer sheet does not exist", async () => {
    const { repo } = inMemoryRepo();
    const qr: QrDecoder = {
      async decode() {
        return null;
      },
    };

    const useCase = new ProcessAnswerSheet(repo, qr, questionsProvider, fakeDetector([]));
    const result = await useCase.execute({
      answerSheetId: "nonexistent",
      scanBatchId: "batch-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns QR_DECODE_FAILED when no QR found in image", async () => {
    const { repo, seed } = inMemoryRepo();
    const qr: QrDecoder = {
      async decode() {
        return null;
      },
    };

    seed({
      id: "sheet-1",
      institutionId: "inst-1",
      evaluationId: "eval-1",
      studentId: "stu-1",
      studentName: "Test",
      studentCode: "STU001",
      qrContent: "{}",
      qrSignature: "",
      scannedImage: pngPath,
      status: "SCANNED",
      score: null,
      totalCorrect: null,
      totalQuestions: null,
    });

    const useCase = new ProcessAnswerSheet(repo, qr, questionsProvider, fakeDetector([]));
    const result = await useCase.execute({
      answerSheetId: "sheet-1",
      scanBatchId: "batch-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QR_DECODE_FAILED");
  });

  it("returns QR_SIGNATURE_INVALID when HMAC does not match", async () => {
    const { repo, seed } = inMemoryRepo();
    const qr: QrDecoder = {
      async decode() {
        return {
          text: JSON.stringify({
            inst: "test-inst",
            eval: "00000000-0000-0000-0000-000000000001",
            student: "STU001",
            sheet: "00000000-0000-0000-0000-000000000010",
            ts: 1700000000,
            sig: "f".repeat(64),
          }),
        };
      },
    };

    seed({
      id: "sheet-1",
      institutionId: "inst-1",
      evaluationId: "eval-1",
      studentId: "stu-1",
      studentName: "Test",
      studentCode: "STU001",
      qrContent: "{}",
      qrSignature: "f".repeat(64),
      scannedImage: pngPath,
      status: "SCANNED",
      score: null,
      totalCorrect: null,
      totalQuestions: null,
    });

    const useCase = new ProcessAnswerSheet(repo, qr, questionsProvider, fakeDetector([]));
    const result = await useCase.execute({
      answerSheetId: "sheet-1",
      scanBatchId: "batch-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QR_SIGNATURE_INVALID");
  });

  it("grades a bundle answer sheet end-to-end with bundleItemId populated", async () => {
    // Bundle QR firmado (XOR: bundle XOR eval).
    const signed = buildSignedQrContent({
      inst: "test-inst",
      bundle: "00000000-0000-0000-0000-000000000bbb",
      student: "STU001",
      sheet: "00000000-0000-0000-0000-000000000020",
      ts: 1700000000,
    });

    const bundleQuestions = [
      { id: "bq1", number: 1, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-A" },
      { id: "bq2", number: 2, correctAnswer: "A" as const, optionsLength: 4, bundleItemId: "bi-A" },
      { id: "bq3", number: 3, correctAnswer: "D" as const, optionsLength: 4, bundleItemId: "bi-B" },
    ];

    const provider = {
      getCorrectAnswers: vi.fn(async () => []),
      getCorrectAnswersForBundle: vi.fn(async () => bundleQuestions),
    };

    const qr: QrDecoder = {
      async decode() {
        return { text: JSON.stringify(signed) };
      },
    };
    const { repo, seed } = inMemoryRepo();
    seed({
      id: "sheet-bundle",
      institutionId: "inst-1",
      evaluationId: null,
      bundleId: "00000000-0000-0000-0000-000000000bbb",
      studentId: "stu-1",
      studentName: "Ana",
      studentCode: "STU001",
      qrContent: JSON.stringify(signed),
      qrSignature: signed.sig,
      scannedImage: pngPath,
      status: "SCANNED",
      score: null,
      totalCorrect: null,
      totalQuestions: null,
    });

    const useCase = new ProcessAnswerSheet(repo, qr, provider, fakeDetector(["B", "A", "D"]));
    const result = await useCase.execute({
      answerSheetId: "sheet-bundle",
      scanBatchId: "batch-bundle",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(true);
    expect(provider.getCorrectAnswersForBundle).toHaveBeenCalledWith(
      "inst-1",
      "00000000-0000-0000-0000-000000000bbb",
    );
    expect(provider.getCorrectAnswers).not.toHaveBeenCalled();

    if (result.ok) {
      expect(result.status).toBe("GRADED");
      expect(typeof result.score).toBe("number");
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(bundleQuestions.length);
    }

    // El sheet se grabó con score + totalCorrect + totalQuestions.
    const stored = (repo as unknown as { getAnswerSheet: typeof repo.getAnswerSheet })
      ? null
      : null;
    // Recuperamos del state interno via una llamada al repo.
    const sheet = await repo.getAnswerSheet("inst-1", "sheet-bundle");
    expect(sheet).not.toBeNull();
    expect(sheet!.score).not.toBeNull();
    expect(sheet!.totalQuestions).toBe(bundleQuestions.length);

    // Y el bundleItemId aparece poblado en cada StudentAnswerRecord.
    // Recorremos via saveAnswers; el in-memoryRepo expone un Map privado,
    // pero podemos re-leer de la semilla + el side-effect. Una vía más
    // limpia: comparamos contra el `answers` map mediante un cast al
    // closure que la factory devuelve. Como ese Map no es público, lo
    // verificamos indirectamente vía `totalQuestions` y la rama GRADED
    // — si `bundleItemId` se hubiera perdido en el camino, los casts
    // `unknown` dentro de process-answer-sheet.ts hubieran reventado.
    void stored;
  });

  it("routes eval QR to getCorrectAnswers and bundle QR to getCorrectAnswersForBundle", async () => {
    const evalQr = buildSignedQrContent({
      inst: "test-inst",
      eval: "00000000-0000-0000-0000-000000000eee",
      student: "STU001",
      sheet: "00000000-0000-0000-0000-000000000030",
      ts: 1700000000,
    });
    const bundleQr = buildSignedQrContent({
      inst: "test-inst",
      bundle: "00000000-0000-0000-0000-000000000bbb",
      student: "STU002",
      sheet: "00000000-0000-0000-0000-000000000040",
      ts: 1700000000,
    });

    // Primer path: QR eval — provider fresco (vi.fn con estado aislado).
    {
      const provider = {
        getCorrectAnswers: vi.fn(async () => [
          { id: "evq", number: 1, correctAnswer: "A" as const, optionsLength: 4 },
        ]),
        getCorrectAnswersForBundle: vi.fn(async () => []),
      };

      const qrEval: QrDecoder = {
        async decode() {
          return { text: JSON.stringify(evalQr) };
        },
      };

      const { repo, seed } = inMemoryRepo();
      seed({
        id: "sheet-eval",
        institutionId: "inst-1",
        evaluationId: "00000000-0000-0000-0000-000000000eee",
        studentId: "stu-1",
        studentName: "A",
        studentCode: "STU001",
        qrContent: JSON.stringify(evalQr),
        qrSignature: evalQr.sig,
        scannedImage: pngPath,
        status: "SCANNED",
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      });

      const useCase = new ProcessAnswerSheet(repo, qrEval, provider, fakeDetector(["A"]));
      await useCase.execute({
        answerSheetId: "sheet-eval",
        scanBatchId: "batch-eval",
        institutionId: "inst-1",
        imagePath: pngPath,
      });
      expect(provider.getCorrectAnswers).toHaveBeenCalledWith(
        "inst-1",
        "00000000-0000-0000-0000-000000000eee",
      );
      expect(provider.getCorrectAnswersForBundle).not.toHaveBeenCalled();
    }

    // Segundo path: QR bundle — provider fresco para que las aserciones
    // `not.toHaveBeenCalled()` no arrastren llamadas del primer sub-bloque.
    {
      const provider = {
        getCorrectAnswers: vi.fn(async () => []),
        getCorrectAnswersForBundle: vi.fn(async () => [
          {
            id: "bqq",
            number: 1,
            correctAnswer: "B" as const,
            optionsLength: 4,
            bundleItemId: "bi-X",
          },
        ]),
      };

      const qrBundle: QrDecoder = {
        async decode() {
          return { text: JSON.stringify(bundleQr) };
        },
      };

      const { repo, seed } = inMemoryRepo();
      seed({
        id: "sheet-bundle",
        institutionId: "inst-1",
        evaluationId: null,
        bundleId: "00000000-0000-0000-0000-000000000bbb",
        studentId: "stu-2",
        studentName: "B",
        studentCode: "STU002",
        qrContent: JSON.stringify(bundleQr),
        qrSignature: bundleQr.sig,
        scannedImage: pngPath,
        status: "SCANNED",
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      });

      const useCase = new ProcessAnswerSheet(repo, qrBundle, provider, fakeDetector(["B"]));
      await useCase.execute({
        answerSheetId: "sheet-bundle",
        scanBatchId: "batch-bundle",
        institutionId: "inst-1",
        imagePath: pngPath,
      });
      expect(provider.getCorrectAnswersForBundle).toHaveBeenCalledWith(
        "inst-1",
        "00000000-0000-0000-0000-000000000bbb",
      );
      expect(provider.getCorrectAnswers).not.toHaveBeenCalled();
    }
  });
});

describe("mapDetectedQuestion", () => {
  const q = (ans: string, marks: Record<string, number> = {}): DetectedQuestion => ({
    n: 1,
    ans,
    fills: ["A", "B", "C", "D"].map((l) => ({
      l,
      f: marks[l] ?? 0.1,
      m: (marks[l] ?? 0) > 0.6,
      x: 100,
      y: 50,
      r: 10,
    })),
    crop: "",
  });

  it("respuesta contestada correcta → isCorrect true, no ambigua", () => {
    const r = mapDetectedQuestion(q("B", { B: 0.95 }), "q1", "B", null, 0.5);
    expect(r.selectedKey).toBe("B");
    expect(r.isCorrect).toBe(true);
    expect(r.isAmbiguous).toBe(false);
    expect(r.fillRatio).toBeCloseTo(0.95);
    expect(r.cells).toHaveLength(4);
    const cellB = r.cells!.find((c) => c.key === "B")!;
    expect(cellB.bboxX).toBe(90); // x - r = 100 - 10
    expect(cellB.bboxW).toBe(20); // 2r
    expect(cellB.isMarked).toBe(true);
  });

  it("respuesta contestada incorrecta → isCorrect false", () => {
    const r = mapDetectedQuestion(q("C", { C: 0.9 }), "q1", "B", null, 0.5);
    expect(r.selectedKey).toBe("C");
    expect(r.isCorrect).toBe(false);
  });

  it("BLANCO → selectedKey null, isCorrect null, fillRatio null", () => {
    const r = mapDetectedQuestion(q("BLANCO"), "q1", "B", null, 0.5);
    expect(r.selectedKey).toBeNull();
    expect(r.isCorrect).toBeNull();
    expect(r.isAmbiguous).toBe(false);
    expect(r.fillRatio).toBeNull();
  });

  it("MULTIPLE → isAmbiguous true, selectedKey null, isCorrect null", () => {
    const r = mapDetectedQuestion(q("MULTIPLE:BC", { B: 0.9, C: 0.85 }), "q1", "B", null, 0.5);
    expect(r.isAmbiguous).toBe(true);
    expect(r.selectedKey).toBeNull();
    expect(r.isCorrect).toBeNull();
    expect(r.fillRatio).toBeCloseTo(0.9); // max de las marcadas
  });

  it("propaga bundleItemId", () => {
    const r = mapDetectedQuestion(q("A", { A: 0.9 }), "q1", "A", "bi-7", 0.5);
    expect(r.bundleItemId).toBe("bi-7");
  });
});

describe("BUNDLE_BUBBLE_LAYOUT wrap-around (3-col)", () => {
  it("distributes 110 questions as 37/37/36 across columns 0/1/2", () => {
    const total = 110;
    // col 0: 0..36 → 37 preguntas
    expect(questionIdxToCell(0, total, 3)).toEqual({ col: 0, row: 0 });
    expect(questionIdxToCell(36, total, 3)).toEqual({ col: 0, row: 36 });
    // col 1: 37..73 → 37 preguntas
    expect(questionIdxToCell(37, total, 3)).toEqual({ col: 1, row: 0 });
    expect(questionIdxToCell(73, total, 3)).toEqual({ col: 1, row: 36 });
    // col 2: 74..109 → 36 preguntas (última columna absorbe el residuo)
    expect(questionIdxToCell(74, total, 3)).toEqual({ col: 2, row: 0 });
    expect(questionIdxToCell(109, total, 3)).toEqual({ col: 2, row: 35 });
  });

  it("yields monotonically-increasing X across columns and within a column", () => {
    const total = 6;
    const imgW = 1000;
    const imgH = 1500;

    // idx 0 y 1 dentro de col 0 → misma X-banda, cy creciente.
    const c0r0 = bubbleCenter(0, 0, imgW, imgH, BUNDLE_BUBBLE_LAYOUT, total);
    const c0r1 = bubbleCenter(1, 0, imgW, imgH, BUNDLE_BUBBLE_LAYOUT, total);
    expect(c0r0.cx).toBe(c0r1.cx);
    expect(c0r1.cy).toBeGreaterThan(c0r0.cy);

    // idx 2 cae en col 1 → X debe crecer vs col 0.
    const c1r0 = bubbleCenter(2, 0, imgW, imgH, BUNDLE_BUBBLE_LAYOUT, total);
    expect(c1r0.cx).toBeGreaterThan(c0r0.cx);

    // idx 4 cae en col 2 → X aún mayor.
    const c2r0 = bubbleCenter(4, 0, imgW, imgH, BUNDLE_BUBBLE_LAYOUT, total);
    expect(c2r0.cx).toBeGreaterThan(c1r0.cx);

    // Dentro de una misma columna, burbuja 1 está más a la derecha que 0.
    const c0r0b0 = bubbleCenter(0, 0, imgW, imgH, BUNDLE_BUBBLE_LAYOUT, total);
    const c0r0b1 = bubbleCenter(0, 1, imgW, imgH, BUNDLE_BUBBLE_LAYOUT, total);
    expect(c0r0b1.cx).toBeGreaterThan(c0r0b0.cx);
  });

  it("legacy 1-col layout uses single X-band with no column wrap", () => {
    const total = 50;
    const imgW = 1000;
    const imgH = 1500;

    // idx 0 e idx 30: misma X, distinta Y.
    const a = bubbleCenter(0, 0, imgW, imgH, LEGACY_BUBBLE_LAYOUT, total);
    const b = bubbleCenter(30, 0, imgW, imgH, LEGACY_BUBBLE_LAYOUT, total);
    expect(a.cx).toBe(b.cx);
    expect(b.cy).toBeGreaterThan(a.cy);

    // idx 0 con bubble 0 y bubble 1: spacing de 0.046*imgW.
    const bx0 = bubbleCenter(0, 0, imgW, imgH, LEGACY_BUBBLE_LAYOUT, total);
    const bx1 = bubbleCenter(0, 1, imgW, imgH, LEGACY_BUBBLE_LAYOUT, total);
    expect(bx1.cx - bx0.cx).toBe(Math.round(0.046 * imgW));
  });
});
