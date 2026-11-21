/**
 * Hoja identificada a mano desde la card "Hojas sin clasificar" del lote.
 *
 * Alguien eligió el cuadernillo y el estudiante porque el QR no servía. Si el
 * worker leyera el QR igual (la carga lee solo con omr-service; el worker
 * además con sharp), podría calificarla contra el cuadernillo del QR —otro, o
 * uno no LISTO— y reemplazar el estudiante elegido. Por eso:
 *   - no se decodifica el QR ni se guarda nada de él;
 *   - se califica con el cuadernillo de la hoja;
 *   - queda GRADED si está limpia (la identidad la puso una persona), y en
 *     Revisión con marcas dudosas, como cualquier hoja.
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

/** Detector falso: "B" marca B; "MULTIPLE:AB" marca A y B. */
function fakeDetector(answers: string[]): OmrDetector {
  return {
    async analyze(): Promise<DetectedSheet> {
      return {
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
      };
    },
  };
}

/** QR válido y firmado, pero de OTRO cuadernillo y otro estudiante. */
function qrDeOtroCuadernillo(): QrDecoder & { decode: ReturnType<typeof vi.fn> } {
  const signed = buildSignedQrContent({
    inst: "test-inst",
    bundle: "00000000-0000-0000-0000-000000000999",
    student: "OTRO01",
    sheet: "00000000-0000-0000-0000-000000000055",
    ts: 1700000000,
  });
  return { decode: vi.fn(async () => ({ text: JSON.stringify(signed) })) };
}

interface Guardado {
  status?: string;
  notes?: string;
  score?: number;
  totalQuestions?: number;
  answers: StudentAnswerRecord[];
  qrGuardado: boolean;
}

function hacerRepo(imagePath: string, identificadaAMano: boolean) {
  const guardado: Guardado = { answers: [], qrGuardado: false };
  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet() {
      return {
        id: "hoja-1",
        institutionId: "inst-1",
        evaluationId: null,
        bundleId: "bundle-elegido",
        studentId: "stu-elegido",
        studentName: null,
        studentCode: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: imagePath,
        status: "PENDING",
        score: null,
        totalCorrect: null,
        totalQuestions: null,
        identificadaAMano,
      };
    },
    async updateSheetStatus(_id, status, data) {
      guardado.status = status;
      guardado.notes = data?.notes;
      if (data?.score !== undefined) guardado.score = data.score;
      if (data?.totalQuestions !== undefined) guardado.totalQuestions = data.totalQuestions;
    },
    async saveDecodedQr() {
      guardado.qrGuardado = true;
      return { duplicada: false, studentId: "stu-del-qr" };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async findDuplicateSheet() {
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

const clave = [
  { id: "q1", number: 1, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q2", number: 2, correctAnswer: "A" as const, optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q3", number: 3, correctAnswer: "D" as const, optionsLength: 4, bundleItemId: "bi-1" },
];

let pngPath: string;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "a-mano-test-"));
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

async function procesar(respuestas: string[], identificadaAMano = true) {
  const { repo, guardado } = hacerRepo(pngPath, identificadaAMano);
  const qr = qrDeOtroCuadernillo();
  const provider = {
    getCorrectAnswers: vi.fn(async () => []),
    getCorrectAnswersForBundle: vi.fn(async () => clave),
  };
  const r = await new ProcessAnswerSheet(repo, qr, provider, fakeDetector(respuestas)).execute({
    answerSheetId: "hoja-1",
    scanBatchId: "lote-1",
    institutionId: "inst-1",
    imagePath: pngPath,
  });
  return { r, guardado, qr, provider };
}

describe("ProcessAnswerSheet - hoja identificada a mano", () => {
  it("no lee el QR y califica con el cuadernillo elegido", async () => {
    const { r, guardado, qr, provider } = await procesar(["B", "A", "C"]);
    expect(qr.decode).not.toHaveBeenCalled();
    expect(guardado.qrGuardado).toBe(false);
    expect(provider.getCorrectAnswersForBundle).toHaveBeenCalledWith("inst-1", "bundle-elegido");
    expect(r.ok).toBe(true);
    expect(guardado.score).toBe(2);
    expect(guardado.totalQuestions).toBe(3);
  });

  it("limpia queda GRADED y sin nota", async () => {
    const { guardado } = await procesar(["B", "A", "D"]);
    expect(guardado.status).toBe("GRADED");
    expect(guardado.notes).toBeUndefined();
  });

  it("con una marca múltiple va a Revisión como cualquier hoja", async () => {
    const { guardado } = await procesar(["MULTIPLE:AB", "A", "D"]);
    expect(guardado.status).toBe("REVIEW");
    expect(guardado.notes).toMatch(/marca múltiple/);
  });

  it("sin la marca, el QR se lee como siempre", async () => {
    const { qr } = await procesar(["B", "A", "D"], false);
    expect(qr.decode).toHaveBeenCalled();
  });
});
