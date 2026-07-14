import sharp from "sharp";
import { verifySignature, deriveInstitutionSecret } from "@/shared/infrastructure/crypto/hmac";
import { env } from "@/config/env";
import { signedQrSchema } from "../domain/qr-payload";
import { readQuestion } from "../domain/bubble-classification";
import { preprocessScan, measureFillRatio } from "../infrastructure/preprocess-image";
import type { AnswerKey } from "../domain/answer-sheet";
import type { ScanningRepository, QrDecoder, StudentAnswerRecord } from "../domain/answer-sheet";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";

export interface EvaluationQuestionsProvider {
  getCorrectAnswers(
    institutionId: string,
    evaluationId: string,
  ): Promise<{ id: string; number: number; correctAnswer: AnswerKey }[]>;
}

export interface BubbleLayout {
  rows: number;
  columns: number;
  startXPct: number;
  startYPct: number;
  spacingXPct: number;
  spacingYPct: number;
  bubbleSizePct: number;
}

const DEFAULT_BUBBLE_LAYOUT: BubbleLayout = {
  rows: 50,
  columns: 4,
  startXPct: 0.35,
  startYPct: 0.05,
  spacingXPct: 0.04,
  spacingYPct: 0.018,
  bubbleSizePct: 0.012,
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
  | { code: "EVALUATION_NOT_FOUND"; message: string }
  | { code: "PROCESSING_ERROR"; message: string };

export type ProcessAnswerSheetResult =
  | { ok: true; answerSheetId: string; status: "GRADED" | "REVIEW"; score: number }
  | { ok: false; error: ProcessAnswerSheetError };

export class ProcessAnswerSheet {
  constructor(
    private readonly repository: ScanningRepository,
    private readonly qrDecoder: QrDecoder,
    private readonly questionsProvider: EvaluationQuestionsProvider,
    private readonly bubbleLayout: BubbleLayout = DEFAULT_BUBBLE_LAYOUT,
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
      imageBuffer = await sharp(imagePath).png().toBuffer();
    } catch {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "Failed to load image",
      });
      return { ok: false, error: { code: "PROCESSING_ERROR", message: "Failed to load image" } };
    }

    const decoded = await this.qrDecoder.decode(imageBuffer);
    if (!decoded) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "QR could not be decoded",
      });
      return { ok: false, error: { code: "QR_DECODE_FAILED", message: "QR could not be decoded" } };
    }

    let qrData: Record<string, unknown>;
    let qrSignature: string;
    try {
      const parsed = JSON.parse(decoded.text);
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

    const correctAnswers = await this.questionsProvider.getCorrectAnswers(
      institutionId,
      parsedQr.data.eval,
    );
    if (correctAnswers.length === 0) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "Evaluation has no questions",
      });
      return {
        ok: false,
        error: {
          code: "EVALUATION_NOT_FOUND",
          message: "Evaluation not found or has no questions",
        },
      };
    }

    let binaryImage: Buffer;
    try {
      binaryImage = await preprocessScan(imageBuffer);
    } catch {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "Image preprocessing failed",
      });
      return {
        ok: false,
        error: { code: "PROCESSING_ERROR", message: "Image preprocessing failed" },
      };
    }

    const metadata = await sharp(binaryImage).metadata();
    const imgW = metadata.width ?? 1000;
    const imgH = metadata.height ?? 1000;

    const layout = this.bubbleLayout;
    const bubbleDiamPx = Math.round(imgW * layout.bubbleSizePct);

    const hasReview = correctAnswers.some((q, idx) => {
      const row = idx;
      const colStart = 0;
      const answers = ANSWER_KEYS_ORDER;
      const readings = answers.map((key, col) => {
        const cx = Math.round(imgW * (layout.startXPct + (colStart + col) * layout.spacingXPct));
        const cy = Math.round(imgH * (layout.startYPct + row * layout.spacingYPct));
        const left = Math.max(0, cx - Math.floor(bubbleDiamPx / 2));
        const top = Math.max(0, cy - Math.floor(bubbleDiamPx / 2));
        const width = Math.min(bubbleDiamPx, imgW - left);
        const height = Math.min(bubbleDiamPx, imgH - top);
        return { key, left, top, width, height };
      });

      return readings.some((r) => r.left < 0 || r.top < 0 || r.width <= 0 || r.height <= 0);
    });

    if (hasReview) {
      await this.repository.updateSheetStatus(answerSheetId, "REVIEW", {
        notes: "Bubble regions out of image bounds; check calibration",
      });
      return {
        ok: false,
        error: { code: "PROCESSING_ERROR", message: "Bubble regions out of bounds" },
      };
    }

    const answers: StudentAnswerRecord[] = [];
    let totalCorrect = 0;

    for (let idx = 0; idx < correctAnswers.length; idx++) {
      const q = correctAnswers[idx]!;
      const row = idx;
      const keys = ANSWER_KEYS_ORDER;

      const bubbleReadings = [];
      for (let col = 0; col < keys.length; col++) {
        const cx = Math.round(imgW * (layout.startXPct + col * layout.spacingXPct));
        const cy = Math.round(imgH * (layout.startYPct + row * layout.spacingYPct));
        const left = Math.max(0, cx - Math.floor(bubbleDiamPx / 2));
        const top = Math.max(0, cy - Math.floor(bubbleDiamPx / 2));
        try {
          const fillRatio = await measureFillRatio(binaryImage, {
            left,
            top,
            width: Math.min(bubbleDiamPx, imgW - left),
            height: Math.min(bubbleDiamPx, imgH - top),
          });
          bubbleReadings.push({ key: keys[col]!, fillRatio });
        } catch {
          bubbleReadings.push({ key: keys[col]!, fillRatio: 0 });
        }
      }

      const reading = readQuestion(bubbleReadings);
      const isCorrect = reading.status === "ANSWERED" && reading.selectedKey === q.correctAnswer;

      if (isCorrect) totalCorrect++;

      answers.push({
        questionId: q.id,
        selectedKey: reading.selectedKey,
        isCorrect: reading.status === "ANSWERED" ? isCorrect : null,
        isAmbiguous: reading.status === "MULTIPLE",
        confidence: reading.confidence,
      });
    }

    const status = answers.some((a) => a.isAmbiguous) ? "REVIEW" : "GRADED";

    await this.repository.saveAnswers(answerSheetId, answers);
    await this.repository.updateSheetStatus(answerSheetId, status, {
      score: totalCorrect,
      totalCorrect,
      totalQuestions: correctAnswers.length,
      notes:
        status === "REVIEW" ? "Some answers had ambiguous marks; review recommended" : undefined,
    });

    await this.repository.updateBatchProgress(scanBatchId, 0);

    return {
      ok: true,
      answerSheetId,
      status,
      score: totalCorrect,
    };
  }
}
