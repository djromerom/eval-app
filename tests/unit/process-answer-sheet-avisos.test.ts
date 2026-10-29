/**
 * Avisos por pregunta del motor OMR en las notas de la hoja (sep 2026).
 *
 * Caso real (hoja 20260918165352987_0004): el motor perdió la fila 7 del
 * bloque 1 y las 104 preguntas siguientes salían corridas una posición. Desde
 * v24 la inserta en blanco y lo avisa en `estructura` ("pregunta 7: fila no
 * detectada…"); la fila 11 llega además con "falta la opción A". Quien corrige
 * la hoja necesita saber QUÉ preguntas mirar, con su número.
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
function fakeDetector(
  answers: string[],
  estructura: string[] = [],
  avisos: Record<number, string> = {},
): OmrDetector {
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
            aviso: avisos[i + 1] ?? "",
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
  // `as ScanningRepository` (en lugar de `: ScanningRepository`) es
  // deliberado: este test también corre contra `c0a3786` (base vieja donde
  // el interface no tiene los métodos de Eliminar). El cast evita el
  // "excess property check" local — los stubs son *extras* aquí pero
  // *requeridos* en el merge sintético de CI contra `af098e5`.
  const repo = {
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
    async recordDeletionAudit(_input: unknown) {},
  } as ScanningRepository;
  return { repo, guardado };
}

let pngPath: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "avisos-test-"));
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

async function calificar(
  respuestas: string[],
  estructura: string[] = [],
  avisos: Record<number, string> = {},
): Promise<Guardado> {
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
  const useCase = new ProcessAnswerSheet(
    repo,
    qr,
    provider,
    fakeDetector(respuestas, estructura, avisos),
  );
  const r = await useCase.execute({
    answerSheetId: "hoja-1",
    scanBatchId: "lote-1",
    institutionId: "inst-1",
    imagePath: pngPath,
  });
  expect(r.ok).toBe(true);
  return guardado;
}

describe("ProcessAnswerSheet - avisos por pregunta", () => {
  it("un aviso por pregunta llega a las notas con su número, sin cambiar el estado", async () => {
    const g = await calificar(["B", "A", "D"], [], { 2: "posible borrado o corrección: C 0.30" });
    // Los avisos por pregunta informan; solo `estructura` o una marca
    // múltiple mandan la hoja a revisión.
    expect(g.status).toBe("GRADED");
    expect(g.notes).toBe("Revisar a mano: pregunta 2 (posible borrado o corrección: C 0.30).");
  });

  it("fila insertada en blanco: la nombra `estructura` y no se repite en la lista", async () => {
    const g = await calificar(
      ["B", "BLANCO", "BLANCO"],
      [
        "pregunta 2: fila no detectada; quedó en blanco para no correr la numeración — corregir a mano",
      ],
      { 2: "fila no detectada: quedó en blanco para corregir a mano", 3: "falta la opción A" },
    );
    expect(g.status).toBe("REVIEW");
    expect(g.notes).toContain("pregunta 2: fila no detectada");
    expect(g.notes).toContain("Revisar a mano: pregunta 3 (falta la opción A).");
    expect(g.notes!.match(/pregunta 2\b/g)).toHaveLength(1);
  });

  it("varios avisos se listan todos, en orden", async () => {
    const g = await calificar(["B", "A", "D"], [], {
      1: "falta la opción A",
      3: "letras ambiguas",
    });
    expect(g.notes).toBe(
      "Revisar a mano: pregunta 1 (falta la opción A); pregunta 3 (letras ambiguas).",
    );
  });

  it("sin avisos no se agrega nada", async () => {
    const g = await calificar(["B", "A", "D"]);
    expect(g.notes).toBeUndefined();
  });
});
