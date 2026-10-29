import path from "node:path";
import sharp from "sharp";
import { verifySignature, deriveInstitutionSecret } from "@/shared/infrastructure/crypto/hmac";
import { env } from "@/config/env";
import { signedQrSchema } from "../domain/qr-payload";
import { EMPTY_THRESHOLD } from "../domain/bubble-classification";
import type { AnswerKey } from "../domain/bubble-classification";
import type { BubbleCellRecord, AnswerKey as DomainAnswerKey } from "../domain/answer-sheet";
import type { ScanningRepository, QrDecoder, StudentAnswerRecord } from "../domain/answer-sheet";
import type { OmrDetector, DetectedSheet, DetectedQuestion } from "../domain/omr-detector";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

export interface EvaluationQuestionsProvider {
  /** Hoja legacy de una sola formulación. */
  getCorrectAnswers(
    institutionId: string,
    evaluationId: string,
  ): Promise<{ id: string; number: number; correctAnswer: AnswerKey; optionsLength: number }[]>;

  /** Hoja de un cuadernillo: une en orden todas las questions de cada item.
   *  `number` es la posición global en la hoja unificada (1-based).
   *  `bundleItemId` permite drill-down del reporte comparativo por item
   *  (Sprint 4).
   *  `disabled` (sprint Preguntas inhabitadas, sep 2026): la pregunta fue
   *  inhabilitada en el cuadernillo y no cuenta para la nota. Sigue en la
   *  lista porque la hoja impresa la tiene y el mapeo es posicional. */
  getCorrectAnswersForBundle(
    institutionId: string,
    bundleId: string,
  ): Promise<
    {
      id: string;
      number: number;
      bundleItemId: string;
      correctAnswer: AnswerKey;
      optionsLength: number;
      disabled?: boolean;
    }[]
  >;
}

/** Layout de la grilla de burbujas en una hoja escaneada. Las coordenadas
 *  son fracciones del ancho/alto de la imagen. Desde Sprint 2 del módulo
 *  cuadernillos, una hoja de bundle renderiza las preguntas en 3 columnas
 *  verticales (estilo PDF institucional), por lo que el lector debe
 *  mapear cada questionIdx → (col, row) antes de muestrear las burbujas. */
export interface BubbleLayout {
  /** (Legacy 1-col) cantidad máxima de filas de preguntas por columna. */
  rows: number;
  /** Cantidad máxima de opciones por pregunta (8 = A–H). */
  columns: number;
  /** Y-inicio de la grilla (independiente del layout). */
  startYPct: number;
  /** Separación vertical entre filas de preguntas. */
  spacingYPct: number;
  /** Diámetro de cada burbuja, en fracción del ancho. */
  bubbleSizePct: number;

  // --- Legacy 1-col (omitir cuando questionColumnCount > 1) ---
  /** (Legacy 1-col) X-inicio del rectángulo de la grilla, en fracción
   *  del ancho de la imagen. Requerido si `questionColumnCount` está
   *  ausente o vale 1. */
  startXPct?: number;
  /** (Legacy 1-col) separación horizontal entre opciones. Requerido si
   *  `questionColumnCount` está ausente o vale 1. */
  spacingXPct?: number;

  // --- 3-col bundle ---
  /** Cantidad de columnas verticales de preguntas. Default 1 (legacy).
   *  Para hojas unificadas de bundle vale 3 (estilo PDF institucional:
   *  preguntas se reparten en orden entre 3 columnas verticales). */
  questionColumnCount?: number;
  /** Ancho de cada columna de preguntas (fracción del ancho). Solo se usa
   *  si `questionColumnCount > 1`. */
  questionColumnWidthPct?: number;
  /** Gap horizontal entre columnas de preguntas (fracción del ancho). */
  questionColumnGapPct?: number;
  /** X-inicio del grid 3-col de preguntas (post QR + student fields). */
  questionGridStartXPct?: number;
  /** Separación horizontal entre burbujas dentro de una columna. */
  bubbleSpacingPct?: number;
  /** Fracción del ancho de la imagen reservada para el número de pregunta
   *  (la columna izquierda de cada `.as-col-row` es de 1.5rem fijo). */
  numberColPct?: number;
}

/** Layout legacy (1-col) — calibrado para hojas con UNA columna vertical de
 *  preguntas y 8 opciones por fila. Coordenadas como fracción del
 *  ancho/alto de la imagen escaneada. 10mm / 215.9mm ≈ 0.046 por columna. */
export const LEGACY_BUBBLE_LAYOUT: BubbleLayout = {
  rows: 50,
  columns: 8,
  startXPct: 0.35,
  startYPct: 0.05,
  spacingXPct: 0.046,
  spacingYPct: 0.018,
  bubbleSizePct: 0.018,
};

/** Layout para hojas unificadas de cuadernillo — 3 columnas verticales de
 *  preguntas (estilo PDF institucional Prueba__11º_I_periodo_C3). Cada
 *  columna apila preguntas con 8 burbujas horizontales.
 *
 *  **Desde Sprint 9 este layout es FALLBACK.** El camino canónico es el
 *  auto-detector (`bubble-detector.ts` + `grid-inference.ts`), que descubre
 *  las burbujas directamente desde la imagen y no depende de estos
 *  porcentajes calibrados. Se mantiene como contingencia si la detección
 *  falla (scan ruidoso, layout no soportado, etc.). */
export const BUNDLE_BUBBLE_LAYOUT: BubbleLayout = {
  rows: 40,
  columns: 8,
  startYPct: 0.05,
  spacingYPct: 0.018,
  bubbleSizePct: 0.026,
  questionColumnCount: 3,
  questionColumnWidthPct: 0.245,
  questionColumnGapPct: 0.01,
  questionGridStartXPct: 0.32,
  bubbleSpacingPct: 0.028,
  numberColPct: 0.025,
};

export interface ProcessAnswerSheetInput {
  answerSheetId: string;
  scanBatchId: string;
  institutionId: string;
  imagePath: string;
}

export type ProcessAnswerSheetError =
  | { code: "NOT_FOUND"; message: string }
  | { code: "QR_DECODE_FAILED"; message: string }
  | { code: "QR_SIGNATURE_INVALID"; message: string }
  | { code: "DUPLICATE_SHEET"; message: string }
  | { code: "EVALUATION_NOT_FOUND"; message: string }
  | { code: "PROCESSING_ERROR"; message: string };

export type ProcessAnswerSheetResult =
  | { ok: true; answerSheetId: string; status: "GRADED" | "REVIEW"; score: number }
  | { ok: false; error: ProcessAnswerSheetError };

/** Mapea el índice global de pregunta (0-based, recorre las preguntas en
 *  orden de impresión) a una celda (columna, fila) del layout 3-col.
 *  Si `colCount <= 1`, devuelve siempre (col=0, row=idx) — comportamiento
 *  legacy. */
export function questionIdxToCell(
  idx: number,
  totalQuestions: number,
  colCount: number,
): { col: number; row: number } {
  if (colCount <= 1) return { col: 0, row: idx };
  const perCol = Math.ceil(totalQuestions / colCount);
  return { col: Math.floor(idx / perCol), row: idx % perCol };
}

/** Calcula el centro (cx, cy) en píxeles de la burbuja `bubbleIdx`
 *  (0..optionsLength-1) para la pregunta con índice global `idx`,
 *  en una imagen de tamaño `imgW × imgH` siguiendo el `layout` dado.
 *  Usado tanto para hojas legacy 1-col como para hojas unificadas 3-col
 *  de cuadernillos. */
export function bubbleCenter(
  idx: number,
  bubbleIdx: number,
  imgW: number,
  imgH: number,
  layout: BubbleLayout,
  totalQuestions: number,
): { cx: number; cy: number } {
  const colCount = layout.questionColumnCount ?? 1;
  const { col, row } = questionIdxToCell(idx, totalQuestions, colCount);

  if (colCount <= 1) {
    // Legacy 1-col: una sola banda de 8 burbujas, X = startXPct + bubbleIdx*spacing.
    const cx = Math.round(imgW * ((layout.startXPct ?? 0) + bubbleIdx * (layout.spacingXPct ?? 0)));
    const cy = Math.round(imgH * (layout.startYPct + row * layout.spacingYPct));
    return { cx, cy };
  }

  // 3-col bundle: cada columna de preguntas tiene su propio rectángulo
  // interno (numberCol + 8 bubbles equally spaced).
  const colStart =
    (layout.questionGridStartXPct ?? 0) +
    col * ((layout.questionColumnWidthPct ?? 0) + (layout.questionColumnGapPct ?? 0));
  const numberCol = layout.numberColPct ?? 0;
  const bubbleSpacing = layout.bubbleSpacingPct ?? 0;
  const cx = Math.round(imgW * (colStart + numberCol + bubbleIdx * bubbleSpacing));
  const cy = Math.round(imgH * (layout.startYPct + row * layout.spacingYPct));
  return { cx, cy };
}

/** A qué se califica la hoja: el cuadernillo o la formulación. */
type ObjetivoHoja = { kind: "bundle"; id: string } | { kind: "evaluation"; id: string };

/** Objetivo del lote, para calificar sin QR. `null` si la hoja no lo tiene. */
function objetivoDelLote(sheet: {
  bundleId: string | null;
  evaluationId: string | null;
}): ObjetivoHoja | null {
  if (sheet.bundleId) return { kind: "bundle", id: sheet.bundleId };
  if (sheet.evaluationId) return { kind: "evaluation", id: sheet.evaluationId };
  return null;
}

export const NOTA_SIN_QR_CUADERNILLO =
  "QR ilegible: se calificó con el cuadernillo del lote. Verifica el estudiante y marca la hoja como revisada.";
export const NOTA_SIN_QR_FORMULACION =
  "QR ilegible: se calificó con la formulación del lote. Verifica el estudiante y marca la hoja como revisada.";

export class ProcessAnswerSheet {
  constructor(
    private readonly repository: ScanningRepository,
    private readonly qrDecoder: QrDecoder,
    private readonly questionsProvider: EvaluationQuestionsProvider,
    /** Detección de burbujas delegada al microservicio Python (omr-service). */
    private readonly detector: OmrDetector,
  ) {}

  async execute(input: ProcessAnswerSheetInput): Promise<ProcessAnswerSheetResult> {
    const { answerSheetId, scanBatchId, institutionId, imagePath } = input;

    const sheet = await this.repository.getAnswerSheet(institutionId, answerSheetId);
    if (!sheet) {
      return { ok: false, error: { code: "NOT_FOUND", message: "Answer sheet not found" } };
    }

    await this.repository.updateSheetStatus(answerSheetId, "PROCESSING");

    let imageBuffer: Buffer;
    try {
      const absoluteImagePath = path.isAbsolute(imagePath)
        ? imagePath
        : path.join(env.STORAGE_DIR, imagePath);
      imageBuffer = await sharp(absoluteImagePath).png().toBuffer();
    } catch (e) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: `Failed to load image: ${(e as Error).message}`,
      });
      return { ok: false, error: { code: "PROCESSING_ERROR", message: "Failed to load image" } };
    }

    // Identificación: por el QR firmado; si el QR no se puede leer y el lote ya
    // dice a qué cuadernillo o formulación pertenece la hoja, se califica con
    // eso (sin estudiante: se asigna a mano) para que la matriz muestre las
    // marcas. La hoja queda en Revisión hasta que alguien la verifique.
    //
    // Una hoja identificada a mano (card "Hojas sin clasificar" del lote) no
    // lee el QR: alguien ya eligió el cuadernillo y el estudiante porque el QR
    // no servía, y si ahora se leyera podría calificarla contra otro
    // cuadernillo o reemplazar el estudiante elegido. También al Reprocesar.
    const aMano = sheet.identificadaAMano === true ? objetivoDelLote(sheet) : null;
    const decoded = aMano ? null : await this.qrDecoder.decode(imageBuffer);
    let objetivo: ObjetivoHoja;
    let sinQr = false;
    if (aMano) {
      objetivo = aMano;
    } else if (decoded) {
      const porQr = await this.identificarPorQr(answerSheetId, decoded.text);
      if ("ok" in porQr) return porQr;
      objetivo = porQr;
    } else {
      const delLote = objetivoDelLote(sheet);
      if (!delLote) {
        await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
          notes: "QR could not be decoded",
        });
        return {
          ok: false,
          error: { code: "QR_DECODE_FAILED", message: "QR could not be decoded" },
        };
      }
      objetivo = delLote;
      sinQr = true;
    }

    const isBundle = objetivo.kind === "bundle";
    const correctAnswers = isBundle
      ? await this.questionsProvider.getCorrectAnswersForBundle(institutionId, objetivo.id)
      : await this.questionsProvider.getCorrectAnswers(institutionId, objetivo.id);
    if (correctAnswers.length === 0) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: isBundle ? "Bundle has no questions" : "Evaluation has no questions",
      });
      return {
        ok: false,
        error: {
          code: "EVALUATION_NOT_FOUND",
          message: "Evaluation not found or has no questions",
        },
      };
    }

    // Cuadernillo con todas sus preguntas inhabilitadas: no hay nada que
    // calificar y la hoja saldría GRADED 0/0 sin nota. MarkBundleReady ya lo
    // impide, esta es la defensa por si el cuadernillo llegó así igual. Se
    // corta antes de la detección para no gastar la llamada al motor.
    if (isBundle && !correctAnswers.some((q) => !("disabled" in q && q.disabled === true))) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "El cuadernillo no tiene preguntas efectivas: todas están inhabilitadas.",
      });
      return {
        ok: false,
        error: {
          code: "EVALUATION_NOT_FOUND",
          message: "Bundle has no effective questions",
        },
      };
    }

    // ===== Detección de burbujas (omr-service, Python) =====
    // Reemplaza la antigua pipeline de visión en TS: el servicio hace deskew,
    // detección y agrupación en preguntas. Aquí solo mapeamos su salida al
    // dominio y puntuamos contra la clave (QR y clave ya resueltos arriba).
    const maxOptions = correctAnswers.reduce((m, q) => Math.max(m, q.optionsLength), 2);
    const letters = ANSWER_KEYS_ORDER.slice(0, Math.min(maxOptions, ANSWER_KEYS_ORDER.length)).join(
      "",
    );

    let detected: DetectedSheet;
    try {
      detected = await this.detector.analyze(imageBuffer, { letters });
    } catch (e) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: `Detección OMR falló: ${(e as Error).message}`,
      });
      return {
        ok: false,
        error: {
          code: "PROCESSING_ERROR",
          message: `OMR detection failed: ${(e as Error).message}`,
        },
      };
    }

    // Guardamos el diagnóstico por celda (con recortes) para la matriz de
    // revisión, aun si la calificación no procede.
    await this.persistCells(scanBatchId, answerSheetId, detected);

    // Sin el mismo número de preguntas que la clave, el mapeo posicional sería
    // inválido. Preferimos REVIEW a calificar mal.
    if (detected.questions.length !== correctAnswers.length) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: `El motor detectó ${detected.questions.length} preguntas; la clave tiene ${correctAnswers.length}. Revisión manual.`,
      });
      await this.repository.updateBatchProgress(scanBatchId, 0);
      return {
        ok: false,
        error: { code: "PROCESSING_ERROR", message: "Detected question count mismatch" },
      };
    }

    // Sprint Preguntas inhabitadas (sep 2026): la respuesta a una pregunta
    // inhabilitada se guarda tal cual (lo que marcó y si acertó), pero no suma
    // a la nota ni al total, y una marca múltiple en ella no manda la hoja a
    // revisión: no puede cambiar la nota.
    const answers: StudentAnswerRecord[] = [];
    let totalCorrect = 0;
    let effectiveQuestions = 0;
    let needsReview = false;
    const avisosPregunta: { posicion: number; aviso: string }[] = [];
    for (let idx = 0; idx < correctAnswers.length; idx++) {
      const q = correctAnswers[idx]!;
      const bundleItemId = isBundle
        ? (q as unknown as { bundleItemId: string }).bundleItemId
        : null;
      const record = mapDetectedQuestion(
        detected.questions[idx]!,
        q.id,
        q.correctAnswer,
        bundleItemId,
        detected.thr,
      );
      const counts = !("disabled" in q && q.disabled === true);
      if (counts) {
        effectiveQuestions++;
        if (record.isCorrect === true) totalCorrect++;
        if (record.isAmbiguous) needsReview = true;
        const aviso = detected.questions[idx]!.aviso;
        if (aviso) avisosPregunta.push({ posicion: idx + 1, aviso });
      }
      answers.push(record);
    }

    // Verificación estructural del motor. El conteo de preguntas (validado
    // arriba contra la clave) no basta: si el motor pierde una fila y de paso
    // se inventa otra —una palabra del encabezado leída como burbujas— el
    // total cuadra, la numeración queda corrida y la nota sale completa,
    // verosímil y equivocada. El motor sabe detectarlo; hasta ahora nadie
    // leía el aviso. Mandar la hoja a revisión cuesta un vistazo; no
    // enterarse cuesta una nota mal puesta.
    const avisosEstructura = detected.estructura ?? [];

    // Sin QR la identidad no está verificada: siempre queda en Revisión.
    const status = sinQr || needsReview || avisosEstructura.length > 0 ? "REVIEW" : "GRADED";
    const notaAmbigua = "Algunas preguntas con marca múltiple o ambigua; revisión recomendada";
    const notaSinQr = isBundle ? NOTA_SIN_QR_CUADERNILLO : NOTA_SIN_QR_FORMULACION;
    const notaBase = sinQr
      ? needsReview
        ? `${notaSinQr} ${notaAmbigua}.`
        : notaSinQr
      : needsReview
        ? notaAmbigua
        : undefined;
    const notaEstructura = avisosEstructura.length
      ? `Lectura estructuralmente sospechosa: ${avisosEstructura.join("; ")}.`
      : undefined;
    // Qué preguntas mirar, con su número: es lo que necesita quien corrige la
    // hoja en la matriz. Las que `estructura` ya nombra ("pregunta 7: fila no
    // detectada…") no se repiten aquí.
    const yaNombradas = new Set(
      avisosEstructura
        .map((a) => /^pregunta (\d+):/.exec(a)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number),
    );
    const porRevisar = avisosPregunta.filter((a) => !yaNombradas.has(a.posicion));
    const notaAvisos = porRevisar.length
      ? `Revisar a mano: ${porRevisar.map((a) => `pregunta ${a.posicion} (${a.aviso})`).join("; ")}.`
      : undefined;

    await this.repository.saveAnswers(answerSheetId, answers);
    await this.repository.updateSheetStatus(answerSheetId, status, {
      score: totalCorrect,
      totalCorrect,
      totalQuestions: effectiveQuestions,
      notes: [notaBase, notaEstructura, notaAvisos].filter(Boolean).join(" ") || undefined,
    });
    await this.repository.updateBatchProgress(scanBatchId, 0);

    return {
      ok: true,
      answerSheetId,
      status,
      score: totalCorrect,
    };
  }

  /** Valida el QR firmado (JSON, firma HMAC de la institución, schema,
   *  anti-duplicado por papel) y asocia al estudiante por su código. Devuelve
   *  el cuadernillo o formulación del QR, o el resultado de error ya
   *  registrado en la hoja. */
  private async identificarPorQr(
    answerSheetId: string,
    qrText: string,
  ): Promise<ObjetivoHoja | ProcessAnswerSheetResult> {
    let qrData: Record<string, unknown>;
    let qrSignature: string;
    try {
      const parsed = JSON.parse(qrText);
      const { sig, ...payload } = parsed;
      qrData = payload;
      qrSignature = sig;
    } catch {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "QR content is not valid JSON",
      });
      return {
        ok: false,
        error: { code: "QR_DECODE_FAILED", message: "QR content is not valid JSON" },
      };
    }

    const institutionCode = qrData.inst as string;
    const secret = deriveInstitutionSecret(env.QR_SIGNING_SECRET, institutionCode);
    if (!verifySignature(qrData, qrSignature, secret)) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "QR signature invalid",
      });
      return {
        ok: false,
        error: { code: "QR_SIGNATURE_INVALID", message: "QR signature does not match" },
      };
    }

    const parsedQr = signedQrSchema.safeParse({ ...qrData, sig: qrSignature });
    if (!parsedQr.success) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "QR payload validation failed",
      });
      return {
        ok: false,
        error: { code: "QR_DECODE_FAILED", message: "QR payload did not match expected schema" },
      };
    }

    // Hoja duplicada: el campo `sheet` del QR identifica el PAPEL, no al
    // estudiante ni la prueba. Si ya hay otra hoja con ese id, este papel ya
    // pasó por el alimentador y volver a calificarlo crearía una segunda nota
    // para el mismo examen físico, sin ninguna señal de que ocurrió.
    //
    // Se corta ANTES de puntuar: calificar y después descartar gastaría una
    // llamada al motor OMR y dejaría respuestas huérfanas en la base.
    const qrSheetUuid = typeof parsedQr.data.sheet === "string" ? parsedQr.data.sheet : null;
    if (qrSheetUuid) {
      const otra = await this.repository.findSheetIdByQrSheetUuid(qrSheetUuid, answerSheetId);
      if (otra) {
        await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
          notes: `Hoja duplicada: este papel ya fue procesado (hoja ${otra.slice(0, 8)}).`,
        });
        return {
          ok: false,
          error: {
            code: "DUPLICATE_SHEET",
            message: "Este papel ya fue escaneado y calificado antes",
          },
        };
      }
    }

    // Persistir el QR decodificado + asociar al estudiante por código.
    const studentCode = typeof parsedQr.data.student === "string" ? parsedQr.data.student : null;
    const guardado = await this.repository.saveDecodedQr(
      answerSheetId,
      qrText,
      qrSignature,
      studentCode,
      qrSheetUuid,
    );
    // El chequeo de arriba deja una ventana: dos duplicados procesándose a la
    // vez lo pasan los dos. El índice único cierra esa ventana y el repo lo
    // reporta acá.
    if (guardado.duplicada) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "Hoja duplicada: este papel ya fue procesado.",
      });
      return {
        ok: false,
        error: {
          code: "DUPLICATE_SHEET",
          message: "Este papel ya fue escaneado y calificado antes",
        },
      };
    }

    return parsedQr.data.bundle
      ? { kind: "bundle", id: parsedQr.data.bundle }
      : { kind: "evaluation", id: parsedQr.data.eval! };
  }

  /** Persiste el diagnóstico de la hoja para la matriz de revisión sin
   *  reprocesar. Escribe dos archivos junto a la imagen escaneada:
   *   - `_cells.json`: detección completa (thr + fills + recortes) — pesado,
   *     lo carga el visor bajo demanda al navegar a una hoja.
   *   - `_grid.json`: resumen compacto (thr + `[{n, ans}]`) — liviano, lo lee
   *     el servidor para armar la cuadrícula de todas las hojas de golpe.
   *  No es bloqueante: la calificación ya quedó guardada. */
  private async persistCells(
    scanBatchId: string,
    answerSheetId: string,
    detected: DetectedSheet,
  ): Promise<void> {
    try {
      // Id COMPLETO, no `slice(0, 8)`: los ids son uuid v7, cuyos primeros
      // bits son el timestamp de creacion. Todas las hojas de un lote se
      // crean en el mismo instante, asi que compartian prefijo y cada hoja
      // pisaba los artefactos de la anterior: un lote de 68 hojas dejaba un
      // unico grid.json, y la matriz de revision mostraba la misma fila 68
      // veces. Si se cambia aca, cambiar tambien los dos lectores:
      // teacher/scan/[batchId]/page.tsx y api/scans/cells/[batchId]/[sheetId].
      const base = `scans/${scanBatchId}/sheet_${answerSheetId}`;
      await localStorage.save(`${base}_cells.json`, Buffer.from(JSON.stringify(detected)));
      const grid = {
        thr: detected.thr,
        answers: detected.questions.map((q) => ({ n: q.n, ans: q.ans })),
      };
      await localStorage.save(`${base}_grid.json`, Buffer.from(JSON.stringify(grid)));
    } catch (e) {
      console.warn("persistCells failed", (e as Error).message);
    }
  }
}

/** Mapea una pregunta detectada por el motor (omr-service) a un
 *  `StudentAnswerRecord`, puntuando contra la clave. `det.ans` ∈
 *  { "A".."H", "BLANCO", "MULTIPLE:XY" }. Función pura: testeable sin red.
 *  `isCorrect` es `true`/`false` para respuestas contestadas y `null` para
 *  BLANK/MULTIPLE (no contestada / inválida). */
export function mapDetectedQuestion(
  det: DetectedQuestion,
  questionId: string,
  correctAnswer: DomainAnswerKey,
  bundleItemId: string | null,
  thr: number,
): StudentAnswerRecord {
  const isMultiple = det.ans.startsWith("MULTIPLE");
  const isBlank = det.ans === "BLANCO";
  const selectedKey: DomainAnswerKey | null =
    !isMultiple && !isBlank ? (det.ans as DomainAnswerKey) : null;
  const isAnswered = selectedKey !== null;

  const cells: BubbleCellRecord[] = det.fills.map((b) => {
    const r = Math.max(1, b.r);
    return {
      key: b.l as DomainAnswerKey,
      fillRatio: b.f,
      state: b.m ? "MARKED" : b.f >= EMPTY_THRESHOLD ? "AMBIGUOUS" : "EMPTY",
      bboxX: Math.round(b.x - r),
      bboxY: Math.round(b.y - r),
      bboxW: Math.round(r * 2),
      bboxH: Math.round(r * 2),
      isMarked: b.m,
    };
  });

  let selectedFillRatio: number | null = null;
  if (selectedKey) {
    selectedFillRatio = cells.find((c) => c.key === selectedKey)?.fillRatio ?? null;
  } else if (isMultiple) {
    const marked = cells.filter((c) => c.isMarked).map((c) => c.fillRatio);
    selectedFillRatio = marked.length ? Math.max(...marked) : null;
  }

  const confidence = isAnswered
    ? Math.min(1, Math.max(0, ((selectedFillRatio ?? 0) - thr) / Math.max(1e-6, 1 - thr)))
    : 1;

  return {
    questionId,
    bundleItemId,
    selectedKey,
    isCorrect: isAnswered ? selectedKey === correctAnswer : null,
    isAmbiguous: isMultiple,
    confidence,
    cells,
    fillRatio: selectedFillRatio,
  };
}
