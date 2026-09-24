/**
 * Hoja con QR ilegible en un lote que ya dice su cuadernillo o formulación.
 *
 * Antes el worker se detenía en "QR could not be decoded": la hoja nunca tenía
 * respuestas y, aunque se le asignara el estudiante a mano, la matriz seguía
 * vacía. Ahora se califica con el objetivo del lote:
 *   - se detecta y se guardan respuestas, nota y diagnóstico (`_cells.json`,
 *     que también usa el recorte de identidad);
 *   - queda en REVIEW con una nota propia: la identidad no está verificada;
 *   - no toca el estudiante (no hay QR del que sacarlo) ni `qrSheetUuid`.
 * Sin objetivo del lote se mantiene el error de siempre.
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
import {
  ProcessAnswerSheet,
  NOTA_SIN_QR_CUADERNILLO,
  NOTA_SIN_QR_FORMULACION,
} from "@/modules/scanning/application/process-answer-sheet";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

vi.mock("@/shared/infrastructure/storage/local-storage", () => ({
  localStorage: { save: vi.fn(async (p: string) => p), read: vi.fn() },
}));

const sinQr: QrDecoder = {
  async decode() {
    return null;
  },
};

/** Detector falso: "B" marca B; "MULTIPLE:AB" marca A y B. */
function fakeDetector(answers: string[]): OmrDetector & { analyze: ReturnType<typeof vi.fn> } {
  const analyze = vi.fn(async (): Promise<DetectedSheet> => ({
    thr: 0.5,
    questions: answers.map((ans, i) => {
      const marked = ans.startsWith("MULTIPLE:") ? ans.slice(9).split("") : [ans];
      return {
        n: i + 1,
        ans,
        fills: ["A", "B", "C", "D"].map((l) => ({
          l,
          f: marked.includes(l) ? 0.95 : 0.1,
          m: marked.includes(l),
          x: 10,
          y: 10,
          r: 8,
        })),
        crop: "",
      };
    }),
  }));
  return { analyze };
}

interface Guardado {
  status?: string;
  notes?: string;
  score?: number;
  totalQuestions?: number;
  answers: StudentAnswerRecord[];
  qrGuardado: boolean;
}

function hacerRepo(
  imagePath: string,
  hoja: { bundleId: string | null; evaluationId: string | null; studentId: string | null },
) {
  const guardado: Guardado = { answers: [], qrGuardado: false };
  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet() {
      return {
        id: "hoja-1",
        institutionId: "inst-1",
        evaluationId: hoja.evaluationId,
        bundleId: hoja.bundleId,
        studentId: hoja.studentId,
        studentName: null,
        studentCode: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: imagePath,
        status: "SCANNED",
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      };
    },
    async updateSheetStatus(_id, status, data) {
      guardado.status = status;
      if (data?.notes !== undefined) guardado.notes = data.notes;
      if (data?.score !== undefined) guardado.score = data.score;
      if (data?.totalQuestions !== undefined) guardado.totalQuestions = data.totalQuestions;
    },
    async saveDecodedQr() {
      guardado.qrGuardado = true;
      return { duplicada: false, studentId: null };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async saveAnswers(_id, ans) {
      guardado.answers = ans;
    },
    async updateBatchProgress() {},
  };
  return { repo, guardado };
}

interface FilaClave {
  id: string;
  number: number;
  correctAnswer: "A" | "B" | "C" | "D";
  optionsLength: number;
  bundleItemId: string;
  disabled?: boolean;
}

const clave: FilaClave[] = [
  { id: "q1", number: 1, correctAnswer: "B", optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q2", number: 2, correctAnswer: "A", optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q3", number: 3, correctAnswer: "D", optionsLength: 4, bundleItemId: "bi-1" },
];

let pngPath: string;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "sin-qr-test-"));
  pngPath = join(dir, "hoja.png");
  writeFileSync(
    pngPath,
    await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer(),
  );
});

async function procesar(
  hoja: { bundleId: string | null; evaluationId: string | null; studentId?: string | null },
  respuestas: string[],
  claveDelProvider: FilaClave[] = clave,
) {
  const { repo, guardado } = hacerRepo(pngPath, { studentId: null, ...hoja });
  const provider = {
    getCorrectAnswers: vi.fn(async () => claveDelProvider),
    getCorrectAnswersForBundle: vi.fn(async () => claveDelProvider),
  };
  const detector = fakeDetector(respuestas);
  const r = await new ProcessAnswerSheet(repo, sinQr, provider, detector).execute({
    answerSheetId: "hoja-1",
    scanBatchId: "lote-1",
    institutionId: "inst-1",
    imagePath: pngPath,
  });
  return { r, guardado, provider, detector };
}

describe("ProcessAnswerSheet - QR ilegible en lote de cuadernillo", () => {
  it("califica con el cuadernillo del lote y guarda las respuestas", async () => {
    const { r, guardado, provider } = await procesar(
      { bundleId: "bundle-lote", evaluationId: null },
      ["B", "A", "C"],
    );
    expect(provider.getCorrectAnswersForBundle).toHaveBeenCalledWith("inst-1", "bundle-lote");
    expect(provider.getCorrectAnswers).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(guardado.score).toBe(2);
    expect(guardado.totalQuestions).toBe(3);
    expect(guardado.answers.map((a) => a.selectedKey)).toEqual(["B", "A", "C"]);
    // bundleItemId se conserva para los reportes por formulación.
    expect(guardado.answers.every((a) => a.bundleItemId === "bi-1")).toBe(true);
  });

  it("queda en Revisión con la nota de QR ilegible, aunque no haya marcas dudosas", async () => {
    const { r, guardado } = await procesar({ bundleId: "bundle-lote", evaluationId: null }, [
      "B",
      "A",
      "D",
    ]);
    expect(guardado.status).toBe("REVIEW");
    expect(guardado.notes).toBe(NOTA_SIN_QR_CUADERNILLO);
    if (r.ok) expect(r.status).toBe("REVIEW");
  });

  it("con marcas múltiples, la nota menciona las dos cosas", async () => {
    const { guardado } = await procesar({ bundleId: "bundle-lote", evaluationId: null }, [
      "MULTIPLE:AB",
      "A",
      "D",
    ]);
    expect(guardado.status).toBe("REVIEW");
    expect(guardado.notes).toContain(NOTA_SIN_QR_CUADERNILLO);
    expect(guardado.notes).toContain("marca múltiple");
  });

  it("no toca el estudiante ni el QR (no llama a saveDecodedQr)", async () => {
    const { guardado } = await procesar(
      { bundleId: "bundle-lote", evaluationId: null, studentId: "stu-asignado" },
      ["B", "A", "D"],
    );
    expect(guardado.qrGuardado).toBe(false);
    // Aun con el estudiante ya asignado (reproceso), sigue en Revisión.
    expect(guardado.status).toBe("REVIEW");
  });

  it("guarda el diagnóstico por celda (_cells.json), que usa el recorte de identidad", async () => {
    vi.mocked(localStorage.save).mockClear();
    await procesar({ bundleId: "bundle-lote", evaluationId: null }, ["B", "A", "D"]);
    const rutas = vi.mocked(localStorage.save).mock.calls.map((c) => c[0]);
    expect(rutas).toContain("scans/lote-1/sheet_hoja-1_cells.json");
  });

  it("respeta las preguntas inhabilitadas", async () => {
    const { guardado } = await procesar(
      { bundleId: "bundle-lote", evaluationId: null },
      ["B", "A", "D"],
      [clave[0]!, { ...clave[1]!, disabled: true }, clave[2]!],
    );
    expect(guardado.score).toBe(2);
    expect(guardado.totalQuestions).toBe(2);
  });

  it("si el conteo de preguntas no coincide con la clave, no califica (misma red de siempre)", async () => {
    const { r, guardado } = await procesar({ bundleId: "bundle-lote", evaluationId: null }, ["B"]);
    expect(r.ok).toBe(false);
    expect(guardado.score).toBeUndefined();
    expect(guardado.notes).toContain("El motor detectó 1 preguntas");
  });
});

describe("ProcessAnswerSheet - QR ilegible en lote de formulación", () => {
  it("califica con la formulación del lote y usa su nota", async () => {
    const { guardado, provider } = await procesar({ bundleId: null, evaluationId: "eval-lote" }, [
      "B",
      "A",
      "D",
    ]);
    expect(provider.getCorrectAnswers).toHaveBeenCalledWith("inst-1", "eval-lote");
    expect(guardado.notes).toBe(NOTA_SIN_QR_FORMULACION);
    expect(guardado.score).toBe(3);
  });
});

describe("ProcessAnswerSheet - QR ilegible sin objetivo del lote", () => {
  it("mantiene el error y no llama al motor", async () => {
    const { r, guardado, detector } = await procesar({ bundleId: null, evaluationId: null }, ["B"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("QR_DECODE_FAILED");
    expect(guardado.notes).toBe("QR could not be decoded");
    expect(detector.analyze).not.toHaveBeenCalled();
  });
});
