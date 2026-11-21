/**
 * Aviso estructural del motor OMR en la calificación (sep 2026).
 *
 * `check_structure` (motor v21) avisa cuando la lectura tiene huecos entre
 * filas o bloques desparejos. El caso que lo motiva: en la hoja `20112_S1` el
 * subtítulo impreso "Estándar Sesión 1 Grado 2 — Cuadernillo" aportó cuatro
 * falsas burbujas (la 'S', 'sió', 'n 1' y la 'G') y se coló como ítem 1,
 * corriendo la numeración de los 35 ítems.
 *
 * Ahí el conteo salvó la hoja (36 detectadas contra 35 de la clave). Pero si
 * además se pierde una fila real, el total vuelve a cuadrar y la nota sale
 * completa, verosímil y equivocada. Por eso el aviso manda a revisión por sí
 * solo, aunque todo lo demás esté en orden.
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

import type { ScanningRepository, QrDecoder } from "@/modules/scanning/domain/answer-sheet";
import type { OmrDetector, DetectedSheet } from "@/modules/scanning/domain/omr-detector";
import { ProcessAnswerSheet } from "@/modules/scanning/application/process-answer-sheet";
import { buildSignedQrContent } from "@/modules/printing/infrastructure/qr-generator";

vi.mock("@/shared/infrastructure/storage/local-storage", () => ({
  localStorage: { save: vi.fn(async (p: string) => p), read: vi.fn() },
}));

const BUNDLE_ID = "00000000-0000-0000-0000-000000000bbb";

/** Detector falso: una pregunta por respuesta, más los avisos estructurales
 *  que el motor haya querido emitir para la hoja completa. */
function fakeDetector(answers: string[], estructura: string[] = []): OmrDetector {
  return {
    async analyze(): Promise<DetectedSheet> {
      return {
        thr: 0.5,
        estructura,
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
  notes?: string;
}

function hacerRepo(qrContent: string, qrSignature: string, imagePath: string) {
  const guardado: Guardado = {};
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
      guardado.notes = data?.notes;
    },
    async saveDecodedQr() {
      return { duplicada: false, studentId: "stu-1" };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async findDuplicateSheet() {
      return null;
    },
    async saveAnswers() {},
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
  const dir = mkdtempSync(join(tmpdir(), "estructura-test-"));
  pngPath = join(dir, "hoja.png");
  const png = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  writeFileSync(pngPath, png);
});

/** Clave de 3 preguntas: B, A, D. */
const CLAVE = [
  { id: "q1", number: 1, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q2", number: 2, correctAnswer: "A" as const, optionsLength: 4, bundleItemId: "bi-2" },
  { id: "q3", number: 3, correctAnswer: "D" as const, optionsLength: 4, bundleItemId: "bi-3" },
];

async function calificar(respuestas: string[], estructura: string[] = []): Promise<Guardado> {
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
    getCorrectAnswersForBundle: vi.fn(async () => CLAVE),
  };
  const useCase = new ProcessAnswerSheet(repo, qr, provider, fakeDetector(respuestas, estructura));
  const r = await useCase.execute({
    answerSheetId: "hoja-1",
    scanBatchId: "lote-1",
    institutionId: "inst-1",
    imagePath: pngPath,
  });
  expect(r.ok).toBe(true);
  return guardado;
}

describe("ProcessAnswerSheet - aviso estructural del motor", () => {
  it("sin avisos califica y no inventa notas", async () => {
    const g = await calificar(["B", "A", "D"]);
    expect(g.status).toBe("GRADED");
    expect(g.score).toBe(3);
    expect(g.notes).toBeUndefined();
  });

  it("un aviso manda la hoja a revisión aunque la lectura sea perfecta", async () => {
    const g = await calificar(
      ["B", "A", "D"],
      ["bloque en x~677: falta(n) 1 fila(s) entre filas contiguas"],
    );
    expect(g.status).toBe("REVIEW");
    // La nota se conserva: el problema es que la numeración puede estar
    // corrida, no que no se haya podido leer.
    expect(g.score).toBe(3);
    expect(g.notes).toContain("falta(n) 1 fila(s)");
  });

  it("el aviso se suma a la nota que ya hubiera, sin pisarla", async () => {
    const g = await calificar(
      ["MULTIPLE:AB", "A", "D"],
      ["los bloques no tienen la misma cantidad"],
    );
    expect(g.status).toBe("REVIEW");
    expect(g.notes).toContain("marca múltiple o ambigua");
    expect(g.notes).toContain("los bloques no tienen la misma cantidad");
  });

  it("varios avisos llegan todos a la nota", async () => {
    const g = await calificar(["B", "A", "D"], ["primer aviso", "segundo aviso"]);
    expect(g.notes).toContain("primer aviso");
    expect(g.notes).toContain("segundo aviso");
  });
});
