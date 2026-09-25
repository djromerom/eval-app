import type { BubbleState } from "./bubble-classification";

export type AnswerKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type AnswerSheetStatus =
  "PENDING" | "SCANNED" | "PROCESSING" | "GRADED" | "REVIEW" | "COMPLETED";

export type ScanBatchStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";

/** Diagnóstico por burbuja individual. Alimenta la UI matriz estilo Remark
 *  y el overlay PNG que se persiste en `AnswerSheet.processedImage`.
 *  `bbox` está en coordenadas de la imagen original (no de la imagen
 *  downsampled que usa el detector). */
export interface BubbleCellRecord {
  key: AnswerKey;
  /** Proporción de píxeles oscuros en la ROI de la burbuja, 0..1. */
  fillRatio: number;
  state: BubbleState;
  bboxX: number;
  bboxY: number;
  bboxW: number;
  bboxH: number;
  /** `true` si la burbuja pasó el umbral MARKED (>0.6) y por tanto es la
   *  candidata a selectedKey (o una de varias, si MULTIPLE). */
  isMarked: boolean;
}

/** Geometría detectada por el auto-detector. La UI matriz la usa para
 *  re-renderizar el grid sin volver a detectar. `rows[i]` = centros de las
 *  8 burbujas de la pregunta i-ésima, ordenados por X. `fallbackUsed` indica
 *  si el lector cayó al layout calibrado hardcodeado (suele significar
 *  detección insuficiente; revisar `detectionConfidence`). */
export interface GridLayoutRecord {
  rows: { x: number; y: number; w: number; h: number }[][];
  cols: number;
  fallbackUsed: boolean;
}

export interface AnswerSheet {
  id: string;
  institutionId: string;
  /** Legacy (single-evaluation) o una hoja del Sprint 1+ antes de bundles. */
  evaluationId: string | null;
  /** Hoja de un cuadernillo (Sprint 1 del módulo cuadernillos). */
  bundleId: string | null;
  /** Lote al que pertenece la hoja. Necesario para que el use case de
   *  correcciones manuales valide que la hoja es del batch que el docente
   *  está revisando. Opcional porque los mocks en memoria de los tests del
   *  worker no siempre lo incluyen — solo lo expone el Prisma repo. */
  scanBatchId?: string | null;
  studentId: string | null;
  studentName: string | null;
  studentCode: string | null;
  qrContent: string;
  qrSignature: string;
  scannedImage: string | null;
  status: AnswerSheetStatus;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  /** La hoja salió de una hoja sin clasificar: alguien eligió el cuadernillo y
   *  el estudiante a mano. El worker entonces no lee el QR, que pudo haberse
   *  leído mal o apuntar a otro cuadernillo, y no toca el estudiante. */
  identificadaAMano?: boolean;
}

export interface ScanBatch {
  id: string;
  institutionId: string;
  /** Legacy: batch de una formulación individual. null para batches de cuadernillo. */
  evaluationId: string | null;
  /** Sprint 1 del módulo cuadernillos: batch cuyas hojas son de un cuadernillo.
   *  null para batches legacy. La invariante XOR (evaluationId XOR bundleId)
   *  se enforceza en el use case, no en el schema. */
  bundleId: string | null;
  status: ScanBatchStatus;
  totalSheets: number;
  processedSheets: number;
}

export interface StudentAnswerRecord {
  questionId: string;
  /** Sprint 4 del módulo cuadernillos: si la hoja pertenece a un bundle, el
   *  item del bundle al que pertenece esta question. Permite drill-down del
   *  reporte comparativo por (student/hoja × item). null en hojas legacy. */
  bundleItemId: string | null;
  selectedKey: AnswerKey | null;
  isCorrect: boolean | null;
  isAmbiguous: boolean;
  confidence: number | null;
  /** Sprint 9 OMR auto-detect: diagnóstico por burbuja individual para la
   *  UI matriz. Incluye el fill ratio de la burbuja marcada, las
   *  candidatas AMBIGUOUS, y la bbox de cada una en coords originales. */
  cells?: BubbleCellRecord[];
  /** Atajo: fill ratio de la burbuja `selectedKey` (o de la más marcada
   *  si MULTIPLE). null si la pregunta quedó BLANK. Lo persistimos aparte
   *  para que la UI no tenga que parsear `cells` en cada render. */
  fillRatio?: number | null;
}

export interface GradingResult {
  answers: StudentAnswerRecord[];
  score: number;
  totalCorrect: number;
  totalQuestions: number;
}

export interface ScanningRepository {
  getScanBatch(institutionId: string, batchId: string): Promise<ScanBatch | null>;
  getAnswerSheet(institutionId: string, sheetId: string): Promise<AnswerSheet | null>;
  /** Persiste el QR decodificado en la hoja y (opcionalmente) asocia al
   *  estudiante por código, considerando el historial de códigos viejos.
   *  Devuelve el studentId resuelto (o null si el código no se encontró). */
  saveDecodedQr(
    sheetId: string,
    qrContent: string,
    qrSignature: string,
    studentCode: string | null,
    /** Campo `sheet` del QR: el id del PAPEL. Se guarda con índice único para
     *  que el mismo papel no pueda calificarse dos veces. */
    qrSheetUuid?: string | null,
  ): Promise<{ studentId: string | null; duplicada: boolean }>;

  /** ¿Ya hay OTRA hoja procesada con este id de papel? `exceptoSheetId` es la
   *  que se está procesando: reprocesar la misma hoja no es un duplicado. */
  findSheetIdByQrSheetUuid(qrSheetUuid: string, exceptoSheetId: string): Promise<string | null>;
  updateSheetStatus(
    sheetId: string,
    status: AnswerSheetStatus,
    data?: {
      score?: number;
      totalCorrect?: number;
      totalQuestions?: number;
      notes?: string;
      /** Grid geométrico detectado (lo escribe el auto-detector). */
      gridLayout?: GridLayoutRecord;
      /** Confianza mediana de la detección 0..1. */
      detectionConfidence?: number;
      /** Ruta a la imagen overlay PNG con detecciones dibujadas. */
      processedImage?: string;
    },
  ): Promise<void>;
  saveAnswers(sheetId: string, answers: StudentAnswerRecord[]): Promise<void>;
  updateBatchProgress(batchId: string, processed: number, status?: ScanBatchStatus): Promise<void>;
}

/** Lectura de las respuestas por hoja. Separado de `ScanningRepository` para
 *  que los mocks de tests del worker (que solo necesitan saveAnswers +
 *  updateSheetStatus) no se vean forzados a implementar el método nuevo. */
export interface StudentAnswersReader {
  /** Devuelve las respuestas de una hoja en el orden de scan del motor (id
   *  asc), que es el mismo orden posicional del grid.json (`n` 1-based).
   *  El use case de correcciones manuales lo necesita para mapear cada
   *  `posicion` del docente a la fila real de StudentAnswer. */
  listStudentAnswersForSheet(sheetId: string): Promise<StudentAnswerRecord[]>;
}

export interface QrDecoder {
  /** `points` son los finder patterns del QR en píxeles del escaneo. Se usan
   *  para registrar la hoja contra su plantilla (ver `registration.ts`).
   *  Opcional: un decoder que no los aporte deja el registro sin ancla y el
   *  lector cae a la detección de rejilla. */
  decode(buffer: Buffer): Promise<{ text: string; points?: { x: number; y: number }[] } | null>;
}

/** Geometría de la hoja tal y como se imprimió. La implementa
 *  infrastructure (mide el render con Puppeteer y la cachea en el bundle);
 *  el use case solo la consume. */
export interface SheetTemplateProvider {
  /** `null` si no se pudo obtener: el lector cae a la detección de rejilla. */
  getForBundle(
    institutionId: string,
    bundleId: string,
  ): Promise<import("@/modules/printing/domain/sheet-template").SheetTemplate | null>;
}

export interface BubbleGridConfig {
  rows: number;
  columns: number;
  startX: number;
  startY: number;
  bubbleDiameter: number;
  spacingX: number;
  spacingY: number;
}

export function calcBubbleCenters(
  config: BubbleGridConfig,
  _imageWidth: number,
  _imageHeight: number,
): { row: number; col: number; cx: number; cy: number }[] {
  const centers: { row: number; col: number; cx: number; cy: number }[] = [];
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.columns; c++) {
      centers.push({
        row: r,
        col: c,
        cx: config.startX + c * config.spacingX,
        cy: config.startY + r * config.spacingY,
      });
    }
  }
  return centers;
}
