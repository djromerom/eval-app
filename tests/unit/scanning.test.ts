import { vi, describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.AUTH_SECRET = "test-auth-secret-1234567890123";
  process.env.QR_SIGNING_SECRET = "test-secret-at-least-16-chars!!";
});

import type { ScanningRepository, QrDecoder } from "@/modules/scanning/domain/answer-sheet";
import { ProcessAnswerSheet } from "@/modules/scanning/application/process-answer-sheet";

function buildFakePng() {
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

interface SheetSeed {
  id: string;
  institutionId: string;
  evaluationId: string;
  studentId: string | null;
  studentName: string | null;
  studentCode: string | null;
  qrContent: string;
  qrSignature: string;
  scannedImage: string;
  status: string;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
}

interface RepoState {
  repo: ScanningRepository;
  seed(sheet: SheetSeed): void;
}

function inMemoryRepo(): RepoState {
  const sheets = new Map<string, SheetSeed>();
  const statuses = new Map<string, { status: string; notes?: string }>();
  const answers = new Map<string, unknown[]>();

  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet(_i, sheetId) {
      const s = sheets.get(sheetId);
      if (!s) return null;
      return {
        id: s.id,
        institutionId: s.institutionId,
        evaluationId: s.evaluationId,
        studentId: s.studentId,
        studentName: s.studentName,
        studentCode: s.studentCode,
        qrContent: s.qrContent,
        qrSignature: s.qrSignature,
        scannedImage: s.scannedImage,
        status: s.status as
          "PENDING" | "SCANNED" | "PROCESSING" | "GRADED" | "REVIEW" | "COMPLETED",
        score: s.score,
        totalCorrect: s.totalCorrect,
        totalQuestions: s.totalQuestions,
      };
    },
    async updateSheetStatus(sheetId, status, data) {
      statuses.set(sheetId, { status, notes: data?.notes });
      const s = sheets.get(sheetId);
      if (s) {
        sheets.set(sheetId, {
          ...s,
          status: status as string,
          ...(data?.score !== undefined ? { score: data.score } : {}),
          ...(data?.totalCorrect !== undefined ? { totalCorrect: data.totalCorrect } : {}),
          ...(data?.totalQuestions !== undefined ? { totalQuestions: data.totalQuestions } : {}),
        });
      }
    },
    async saveAnswers(sheetId, ans) {
      answers.set(sheetId, ans);
    },
    async updateBatchProgress() {},
  };

  return {
    repo,
    seed(sheet: SheetSeed) {
      sheets.set(sheet.id, { ...sheet });
    },
  };
}

let pngPath: string;

beforeAll(async () => {
  const tmpDir = mkdtempSync("scanning-test-");
  pngPath = join(tmpDir, "test.png");
  writeFileSync(pngPath, await buildFakePng());
});

describe("ProcessAnswerSheet", () => {
  const questions = [
    { id: "q1", number: 1, correctAnswer: "B" as const },
    { id: "q2", number: 2, correctAnswer: "A" as const },
    { id: "q3", number: 3, correctAnswer: "D" as const },
  ];

  const questionsProvider = { getCorrectAnswers: async () => questions };

  it("returns NOT_FOUND when answer sheet does not exist", async () => {
    const { repo } = inMemoryRepo();
    const qr: QrDecoder = {
      async decode() {
        return null;
      },
    };

    const useCase = new ProcessAnswerSheet(repo, qr, questionsProvider);
    const result = await useCase.execute({
      answerSheetId: "nonexistent",
      scanBatchId: "batch-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns QR_DECODE_FAILED when no QR found in image", async () => {
    const { repo, seed } = inMemoryRepo();
    const qr: QrDecoder = {
      async decode() {
        return null;
      },
    };

    seed({
      id: "sheet-1",
      institutionId: "inst-1",
      evaluationId: "eval-1",
      studentId: "stu-1",
      studentName: "Test",
      studentCode: "STU001",
      qrContent: "{}",
      qrSignature: "",
      scannedImage: pngPath,
      status: "SCANNED",
      score: null,
      totalCorrect: null,
      totalQuestions: null,
    });

    const useCase = new ProcessAnswerSheet(repo, qr, questionsProvider);
    const result = await useCase.execute({
      answerSheetId: "sheet-1",
      scanBatchId: "batch-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QR_DECODE_FAILED");
  });

  it("returns QR_SIGNATURE_INVALID when HMAC does not match", async () => {
    const { repo, seed } = inMemoryRepo();
    const qr: QrDecoder = {
      async decode() {
        return {
          text: JSON.stringify({
            inst: "test-inst",
            eval: "00000000-0000-0000-0000-000000000001",
            student: "STU001",
            sheet: "00000000-0000-0000-0000-000000000010",
            ts: 1700000000,
            sig: "f".repeat(64),
          }),
        };
      },
    };

    seed({
      id: "sheet-1",
      institutionId: "inst-1",
      evaluationId: "eval-1",
      studentId: "stu-1",
      studentName: "Test",
      studentCode: "STU001",
      qrContent: "{}",
      qrSignature: "f".repeat(64),
      scannedImage: pngPath,
      status: "SCANNED",
      score: null,
      totalCorrect: null,
      totalQuestions: null,
    });

    const useCase = new ProcessAnswerSheet(repo, qr, questionsProvider);
    const result = await useCase.execute({
      answerSheetId: "sheet-1",
      scanBatchId: "batch-1",
      institutionId: "inst-1",
      imagePath: pngPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QR_SIGNATURE_INVALID");
  });
});
