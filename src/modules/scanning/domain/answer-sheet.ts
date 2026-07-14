export type AnswerKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type AnswerSheetStatus =
  "PENDING" | "SCANNED" | "PROCESSING" | "GRADED" | "REVIEW" | "COMPLETED";

export type ScanBatchStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";

export interface AnswerSheet {
  id: string;
  institutionId: string;
  evaluationId: string;
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
}

export interface ScanBatch {
  id: string;
  institutionId: string;
  evaluationId: string | null;
  status: ScanBatchStatus;
  totalSheets: number;
  processedSheets: number;
}

export interface StudentAnswerRecord {
  questionId: string;
  selectedKey: AnswerKey | null;
  isCorrect: boolean | null;
  isAmbiguous: boolean;
  confidence: number | null;
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
  updateSheetStatus(
    sheetId: string,
    status: AnswerSheetStatus,
    data?: { score?: number; totalCorrect?: number; totalQuestions?: number; notes?: string },
  ): Promise<void>;
  saveAnswers(sheetId: string, answers: StudentAnswerRecord[]): Promise<void>;
  updateBatchProgress(batchId: string, processed: number, status?: ScanBatchStatus): Promise<void>;
}

export interface QrDecoder {
  decode(buffer: Buffer): Promise<{ text: string } | null>;
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
