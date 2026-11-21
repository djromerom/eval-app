/**
 * Papeles duplicados: el mismo papel escaneado dos veces.
 *
 * El campo `sheet` del QR identifica el PAPEL, no al estudiante ni la prueba:
 * se genera con randomUUID al imprimir, uno por hoja física. El mismo papel
 * puede volver a pasar por el alimentador (doble pase) o ser reescaneado y
 * subido de nuevo por el docente.
 *
 * Reglas (docente, nov 2026):
 *   - MISMO lote → se queda la que TIENE RESPUESTAS (la calificada) y la que
 *     no las tiene se borra.
 *   - OTRO lote → la carga nueva SOBREESCRIBE la que ya estaba reprocesada:
 *     se borra la vieja y la nueva es la que vale.
 *
 * Antes esto se cortaba siempre: la hoja nueva quedaba en REVIEW con "hoja
 * duplicada" y la vieja conservaba la nota vieja, así que el docente veía dos
 * hojas del mismo papel y no podía deshacerse de la que no servía.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
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
  DuplicateSheetInfo,
  ScanningRepository,
  QrDecoder,
  StudentAnswerRecord,
} from "@/modules/scanning/domain/answer-sheet";
import type { OmrDetector, DetectedSheet } from "@/modules/scanning/domain/omr-detector";
import { ProcessAnswerSheet } from "@/modules/scanning/application/process-answer-sheet";
import { deriveInstitutionSecret, signPayload } from "@/shared/infrastructure/crypto/hmac";
import { env } from "@/config/env";

const BUNDLE_ID = "11111111-1111-4111-8111-111111111111";
const PAPEL_ID = "22222222-2222-4222-8222-222222222222";
const HOJA_ACTUAL = "hoja-actual";
const HOJA_DUPLICADA = "hoja-duplicada";

/** QR firmado válido: el worker verifica la firma antes de deduplicar. */
function qrFirmado(papelId: string): string {
  const payload = {
    inst: "INST-1",
    student: "STU-1",
    sheet: papelId,
    ts: 1_700_000_000_000,
    bundle: BUNDLE_ID,
  };
  const secret = deriveInstitutionSecret(env.QR_SIGNING_SECRET, "INST-1");
  return JSON.stringify({ ...payload, sig: signPayload(payload, secret) });
}

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
            x: 10,
            y: 10,
            r: 8,
          })),
          crop: "",
        })),
      };
    },
  };
}

interface Borrada {
  id: string;
  forzar: boolean;
}

function hacerRepo(cfg: {
  /** La otra hoja que ya tiene este papel (null = papel nuevo). */
  duplicada?: DuplicateSheetInfo | null;
  /** Lo que devuelve la búsqueda en la SEGUNDA llamada (la de la carrera:
   *  el chequeo previo no la vio, pero el índice único sí chocó). */
  duplicadaEnLaCarrera?: DuplicateSheetInfo | null;
  /** El índice único choca al escribir (carrera entre dos workers). */
  chocarAlEscribir?: boolean;
}) {
  const estados: { status: string; notes?: string }[] = [];
  const borradas: Borrada[] = [];
  const respuestas: StudentAnswerRecord[] = [];
  let busquedas = 0;
  // El índice único de `qrSheetUuid` se libera cuando la fila que lo tenía
  // se borra: eso es lo que permite que la hoja que sigue en pie pueda
  // escribir su id de papel después de resolver el duplicado.
  let borradaLaDuplicada = false;
  const idDuplicada = (cfg.duplicada ?? cfg.duplicadaEnLaCarrera)?.id;
  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet() {
      return {
        id: HOJA_ACTUAL,
        institutionId: "inst-1",
        evaluationId: null,
        bundleId: BUNDLE_ID,
        studentId: null,
        studentName: null,
        studentCode: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: "scans/lote-1/hoja.png",
        status: "SCANNED",
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      };
    },
    async updateSheetStatus(_id, status, data) {
      estados.push({ status, notes: data?.notes });
    },
    async saveDecodedQr() {
      if (cfg.chocarAlEscribir && !borradaLaDuplicada) return { studentId: null, duplicada: true };
      return { studentId: "stu-1", duplicada: false };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async findDuplicateSheet() {
      busquedas++;
      if (busquedas === 1) return cfg.duplicada ?? null;
      return cfg.duplicadaEnLaCarrera ?? cfg.duplicada ?? null;
    },
    async saveAnswers(_id, ans) {
      respuestas.push(...ans);
    },
    async updateBatchProgress() {},
    async deleteSheet(sheetId, opciones) {
      borradas.push({ id: sheetId, forzar: opciones?.forzar ?? false });
      if (sheetId === idDuplicada) borradaLaDuplicada = true;
      return { batchId: "lote-1" };
    },
    async findBatchAccess() {
      return null;
    },
    async deleteBatch() {
      return { institutionId: null };
    },
    async recordDeletionAudit() {},
  };
  return { repo, estados, borradas, respuestas };
}

function duplicada(over: Partial<DuplicateSheetInfo> = {}): DuplicateSheetInfo {
  return {
    id: HOJA_DUPLICADA,
    scanBatchId: "lote-1",
    status: "GRADED",
    score: 2,
    totalCorrect: 2,
    tieneRespuestas: true,
    ...over,
  };
}

const clave = [
  { id: "q1", number: 1, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q2", number: 2, correctAnswer: "A" as const, optionsLength: 4, bundleItemId: "bi-1" },
  { id: "q3", number: 3, correctAnswer: "D" as const, optionsLength: 4, bundleItemId: "bi-1" },
];

let pngPath: string;
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "duplicados-test-"));
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

async function procesar(cfg: {
  duplicada?: DuplicateSheetInfo | null;
  duplicadaEnLaCarrera?: DuplicateSheetInfo | null;
  chocarAlEscribir?: boolean;
}) {
  const { repo, estados, borradas, respuestas } = hacerRepo(cfg);
  const decoder: QrDecoder = {
    async decode() {
      return { text: qrFirmado(PAPEL_ID), points: [] };
    },
  };
  const provider = {
    getCorrectAnswers: vi.fn(async () => []),
    getCorrectAnswersForBundle: vi.fn(async () => clave),
  };
  const r = await new ProcessAnswerSheet(
    repo,
    decoder,
    provider,
    fakeDetector(["B", "A", "D"]),
  ).execute({
    answerSheetId: HOJA_ACTUAL,
    scanBatchId: "lote-1",
    institutionId: "inst-1",
    imagePath: pngPath,
  });
  return { r, estados, borradas, respuestas };
}

describe("papeles duplicados", () => {
  it("papel nuevo: se califica y no se borra nada", async () => {
    const { r, borradas, respuestas } = await procesar({ duplicada: null });
    expect(r.ok).toBe(true);
    expect("descartada" in r).toBe(false);
    expect(respuestas).toHaveLength(3);
    expect(borradas).toEqual([]);
  });

  it("mismo lote y la otra tiene respuestas: se queda la calificada y esta se descarta", async () => {
    const { r, borradas, respuestas } = await procesar({
      duplicada: duplicada({ scanBatchId: "lote-1", tieneRespuestas: true }),
    });
    expect(r.ok).toBe(true);
    expect("descartada" in r && r.descartada).toBe(true);
    // No se califica: ni respuestas ni nota para una hoja que ya no existe.
    expect(respuestas).toEqual([]);
    // La hoja que se borra es la que se estaba procesando (aún PROCESSING).
    expect(borradas).toEqual([{ id: HOJA_ACTUAL, forzar: true }]);
  });

  it("mismo lote y la otra NO tiene respuestas: se borra la duplicada y se califica esta", async () => {
    const { r, borradas, respuestas } = await procesar({
      duplicada: duplicada({ scanBatchId: "lote-1", tieneRespuestas: false, score: null }),
    });
    expect(r.ok).toBe(true);
    expect("descartada" in r).toBe(false);
    expect(respuestas).toHaveLength(3);
    expect(borradas).toEqual([{ id: HOJA_DUPLICADA, forzar: false }]);
  });

  it("otro lote: la carga nueva sobrescribe la que ya estaba reprocesada", async () => {
    const { r, borradas, respuestas } = await procesar({
      duplicada: duplicada({ scanBatchId: "lote-anterior", tieneRespuestas: true }),
    });
    expect(r.ok).toBe(true);
    expect("descartada" in r).toBe(false);
    expect(respuestas).toHaveLength(3);
    // Se borra la vieja (la que ya estaba calificada en el lote anterior) y
    // la nueva queda con la nota de este escaneo.
    expect(borradas).toEqual([{ id: HOJA_DUPLICADA, forzar: false }]);
  });

  it("la carrera entre dos workers aplica la misma regla", async () => {
    // Ambos pasan el chequeo previo y uno choca al escribir por el índice
    // único: el repo lo reporta y se aplica la regla del mismo lote.
    const { r, borradas, respuestas } = await procesar({
      duplicada: null,
      chocarAlEscribir: true,
    });
    // Sin ficha de la duplicada no hay contra quién comparar: la hoja queda
    // en revisión, como antes.
    expect(r.ok).toBe(false);
    expect(respuestas).toEqual([]);
    expect(borradas).toEqual([]);
  });

  it("la carrera con la duplicada conocida: gana la que tiene respuestas", async () => {
    // El chequeo previo no vio a la otra hoja (aún no estaba commiteada el
    // id de papel), pero el índice único choca al escribir: la segunda
    // búsqueda la encuentra y se aplica la misma regla.
    const { r, borradas, respuestas } = await procesar({
      duplicada: null,
      duplicadaEnLaCarrera: duplicada({ scanBatchId: "lote-1", tieneRespuestas: true }),
      chocarAlEscribir: true,
    });
    expect(r.ok).toBe(true);
    expect("descartada" in r && r.descartada).toBe(true);
    expect(respuestas).toEqual([]);
    expect(borradas).toEqual([{ id: HOJA_ACTUAL, forzar: true }]);
  });

  it("la carrera entre lotes: la carga nueva pisa a la vieja", async () => {
    const { r, borradas, respuestas } = await procesar({
      duplicada: null,
      duplicadaEnLaCarrera: duplicada({ scanBatchId: "lote-anterior", tieneRespuestas: true }),
      chocarAlEscribir: true,
    });
    expect(r.ok).toBe(true);
    expect("descartada" in r).toBe(false);
    expect(respuestas).toHaveLength(3);
    expect(borradas).toEqual([{ id: HOJA_DUPLICADA, forzar: false }]);
  });
});
