/**
 * Preguntas inhabilitadas del cuadernillo en la calificación (sprint
 * Preguntas inhabitadas, sep 2026 — PR #2).
 *
 * Una pregunta inhabilitada sigue en la hoja impresa, así que el mapeo
 * posicional detección ↔ clave no cambia. Lo que cambia:
 *   - no suma a la nota ni al total (`score`, `totalCorrect`, `totalQuestions`);
 *   - su respuesta se guarda tal cual (lo que marcó y si acertó);
 *   - una marca múltiple en ella no manda la hoja a revisión.
 */
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

import type {
  ScanningRepository,
  QrDecoder,
  StudentAnswerRecord,
} from "@/modules/scanning/domain/answer-sheet";
import type { OmrDetector, DetectedSheet } from "@/modules/scanning/domain/omr-detector";
import { ProcessAnswerSheet } from "@/modules/scanning/application/process-answer-sheet";
import { buildSignedQrContent } from "@/modules/printing/infrastructure/qr-generator";

vi.mock("@/shared/infrastructure/storage/local-storage", () => ({
  localStorage: { save: vi.fn(async (p: string) => p), read: vi.fn() },
}));

const BUNDLE_ID = "00000000-0000-0000-0000-000000000bbb";

/** Detector falso: una pregunta por entrada. "B" marca B; "MULTIPLE:AB"
 *  marca A y B; "BLANCO" no marca nada. */
function fakeDetector(answers: string[]): OmrDetector {
  return {
    async analyze(): Promise<DetectedSheet> {
      return {
        thr: 0.5,
        questions: answers.map((ans, i) => {
          const marked = ans.startsWith("MULTIPLE:")
            ? ans.slice("MULTIPLE:".length).split("")
            : ans === "BLANCO"
              ? []
              : [ans];
          return {
            n: i + 1,
            ans,
            fills: ["A", "B", "C", "D"].map((l) => ({
              l,
              f: marked.includes(l) ? 0.95 : 0.1,
              m: marked.includes(l),
              x: 10 + i,
              y: 10 + i,
              r: 8,
            })),
            crop: "",
          };
        }),
      };
    },
  };
}

interface Guardado {
  status?: string;
  score?: number;
  totalCorrect?: number;
  totalQuestions?: number;
  answers: StudentAnswerRecord[];
}

/** Repo mínimo que captura lo que el use case escribe. */
function hacerRepo(qrContent: string, qrSignature: string, imagePath: string) {
  const guardado: Guardado = { answers: [] };
  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet() {
      return {
        id: "hoja-1",
        institutionId: "inst-1",
        evaluationId: null,
        bundleId: BUNDLE_ID,
        studentId: "stu-1",
        studentName: "Ana",
        studentCode: "STU001",
        qrContent,
        qrSignature,
        scannedImage: imagePath,
        status: "SCANNED",
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      };
    },
    async updateSheetStatus(_id, status, data) {
      guardado.status = status;
      if (data?.score !== undefined) guardado.score = data.score;
      if (data?.totalCorrect !== undefined) guardado.totalCorrect = data.totalCorrect;
      if (data?.totalQuestions !== undefined) guardado.totalQuestions = data.totalQuestions;
    },
    async saveDecodedQr() {
      return { duplicada: false, studentId: "stu-1" };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async saveAnswers(_id, ans) {
      guardado.answers = ans;
    },
    async updateBatchProgress() {},
    async deleteSheet(_sheetId: string) {
      return { batchId: null };
    },
    async findBatchAccess(_batchId: string) {
      return null;
    },
    async deleteBatch(_batchId: string) {
      return { institutionId: null };
    },
    async recordDeletionAudit(_input) {},
  };
  return { repo, guardado };
}

let pngPath: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "inhabilitadas-test-"));
  pngPath = join(dir, "hoja.png");
  const png = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  writeFileSync(pngPath, png);
});

/** Clave de 3 preguntas: B, A, D. `disabled` marca cuáles no cuentan. */
function clave(disabled: Partial<Record<"q1" | "q2" | "q3", boolean>> = {}) {
  return [
    {
      id: "q1",
      number: 1,
      correctAnswer: "B" as const,
      optionsLength: 4,
      bundleItemId: "bi-1",
      disabled: disabled.q1,
    },
    {
      id: "q2",
      number: 2,
      correctAnswer: "A" as const,
      optionsLength: 4,
      bundleItemId: "bi-1",
      disabled: disabled.q2,
    },
    {
      id: "q3",
      number: 3,
      correctAnswer: "D" as const,
      optionsLength: 4,
      bundleItemId: "bi-1",
      disabled: disabled.q3,
    },
  ];
}

async function calificar(rows: ReturnType<typeof clave>, respuestas: string[]): Promise<Guardado> {
  const signed = buildSignedQrContent({
    inst: "test-inst",
    bundle: BUNDLE_ID,
    student: "STU001",
    sheet: "00000000-0000-0000-0000-000000000077",
    ts: 1700000000,
  });
  const qr: QrDecoder = {
    async decode() {
      return { text: JSON.stringify(signed) };
    },
  };
  const { repo, guardado } = hacerRepo(JSON.stringify(signed), signed.sig, pngPath);
  const provider = {
    getCorrectAnswers: vi.fn(async () => []),
    getCorrectAnswersForBundle: vi.fn(async () => rows),
  };
  const useCase = new ProcessAnswerSheet(repo, qr, provider, fakeDetector(respuestas));
  const r = await useCase.execute({
    answerSheetId: "hoja-1",
    scanBatchId: "lote-1",
    institutionId: "inst-1",
    imagePath: pngPath,
  });
  expect(r.ok).toBe(true);
  return guardado;
}

describe("ProcessAnswerSheet - preguntas inhabilitadas", () => {
  it("sin inhabilitadas califica igual que antes (3 de 3)", async () => {
    const g = await calificar(clave(), ["B", "A", "D"]);
    expect(g.status).toBe("GRADED");
    expect(g.score).toBe(3);
    expect(g.totalCorrect).toBe(3);
    expect(g.totalQuestions).toBe(3);
  });

  it("una inhabilitada acertada no suma a la nota ni al total", async () => {
    const g = await calificar(clave({ q2: true }), ["B", "A", "D"]);
    expect(g.score).toBe(2);
    expect(g.totalCorrect).toBe(2);
    expect(g.totalQuestions).toBe(2);
  });

  it("una inhabilitada fallada no baja la nota", async () => {
    const g = await calificar(clave({ q2: true }), ["B", "C", "D"]);
    expect(g.score).toBe(2);
    expect(g.totalQuestions).toBe(2);
  });

  it("la respuesta a la inhabilitada se guarda tal cual", async () => {
    const g = await calificar(clave({ q2: true }), ["B", "A", "D"]);
    // Las 3 respuestas se guardan: el mapeo es posicional y la matriz de
    // revisión sigue mostrando lo que marcó el estudiante.
    expect(g.answers.map((a) => a.questionId)).toEqual(["q1", "q2", "q3"]);
    const q2 = g.answers.find((a) => a.questionId === "q2")!;
    expect(q2.selectedKey).toBe("A");
    expect(q2.isCorrect).toBe(true);
  });

  it("una marca múltiple en la inhabilitada NO manda la hoja a revisión", async () => {
    const g = await calificar(clave({ q2: true }), ["B", "MULTIPLE:AB", "D"]);
    expect(g.status).toBe("GRADED");
    expect(g.score).toBe(2);
  });

  it("una marca múltiple en una pregunta que cuenta SÍ manda a revisión", async () => {
    const g = await calificar(clave({ q2: true }), ["MULTIPLE:AB", "A", "D"]);
    expect(g.status).toBe("REVIEW");
    // q1 no suma (marca múltiple) y q2 no cuenta: solo q3.
    expect(g.score).toBe(1);
    expect(g.totalQuestions).toBe(2);
  });

  it("disabled: false se trata igual que ausente", async () => {
    const g = await calificar(clave({ q1: false, q2: false, q3: false }), ["B", "A", "D"]);
    expect(g.score).toBe(3);
    expect(g.totalQuestions).toBe(3);
  });

  it("con todas las preguntas inhabilitadas la hoja va a REVIEW sin nota", async () => {
    const signed = buildSignedQrContent({
      inst: "test-inst",
      bundle: BUNDLE_ID,
      student: "STU001",
      sheet: "00000000-0000-0000-0000-000000000078",
      ts: 1700000000,
    });
    const qr: QrDecoder = {
      async decode() {
        return { text: JSON.stringify(signed) };
      },
    };
    const { repo, guardado } = hacerRepo(JSON.stringify(signed), signed.sig, pngPath);
    const provider = {
      getCorrectAnswers: vi.fn(async () => []),
      getCorrectAnswersForBundle: vi.fn(async () => clave({ q1: true, q2: true, q3: true })),
    };
    const analyze = vi.fn();
    const useCase = new ProcessAnswerSheet(repo, qr, provider, { analyze });
    const r = await useCase.execute({
      answerSheetId: "hoja-1",
      scanBatchId: "lote-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });
    expect(r.ok).toBe(false);
    expect(guardado.status).toBe("REVIEW");
    expect(guardado.score).toBeUndefined();
    expect(guardado.answers).toEqual([]);
    // Corta antes de llamar al motor OMR.
    expect(analyze).not.toHaveBeenCalled();
  });
});
