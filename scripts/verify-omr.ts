import sharp from "sharp";
import QRCode from "qrcode";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signPayload, deriveInstitutionSecret } from "@/shared/infrastructure/crypto/hmac";
import type { ScanningRepository, QrDecoder } from "@/modules/scanning/domain/answer-sheet";
import { ProcessAnswerSheet } from "@/modules/scanning/application/process-answer-sheet";

const QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET;
if (!QR_SIGNING_SECRET) {
  console.error("Define QR_SIGNING_SECRET en .env");
  process.exit(1);
}

const INST_CODE = "demo-inst";
const EVAL_ID = "00000000-0000-0000-0000-000000000001";
const STUDENT_CODE = "STU001";
const SHEET_ID = "00000000-0000-0000-0000-000000000010";

function inMemoryRepo(): ScanningRepository {
  const logs: string[] = [];
  return {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet() {
      return {
        id: SHEET_ID,
        institutionId: "inst-1",
        evaluationId: EVAL_ID,
        bundleId: null,
        studentId: "stu-1",
        studentName: "Demo",
        studentCode: STUDENT_CODE,
        qrContent: "",
        qrSignature: "",
        scannedImage: "",
        status: "SCANNED" as const,
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      };
    },
    async updateSheetStatus(_id, status, data) {
      logs.push(`status=${status}${data?.notes ? ` (${data.notes})` : ""}`);
      if (data?.score !== undefined) logs.push(`score=${data.score}/${data.totalQuestions}`);
    },
    async saveAnswers(_id, ans) {
      const ok = ans.filter((a) => a.isCorrect).length;
      for (const a of ans) {
        logs.push(
          `  q ${a.selectedKey ?? "—"} ${a.isCorrect ? "✓" : "✗"}${a.isAmbiguous ? " ⚠" : ""}`,
        );
      }
      logs.push(`answers=${ans.length} correct=${ok}`);
    },
    async updateBatchProgress() {
      logs.push("batch progress");
    },
    getLogs() {
      return logs;
    },
  } as ScanningRepository;
}

async function main() {
  console.log("OMR Pipeline Verification");
  console.log("=".repeat(40));

  const secret = deriveInstitutionSecret(QR_SIGNING_SECRET!, INST_CODE);
  const payload = {
    inst: INST_CODE,
    eval: EVAL_ID,
    student: STUDENT_CODE,
    sheet: SHEET_ID,
    ts: Date.now(),
  };
  const sig = signPayload(payload, secret);
  const qrPng = Buffer.from(
    (
      await QRCode.toDataURL(JSON.stringify({ ...payload, sig }), { width: 256, margin: 1 })
    ).replace(/^data:image\/png;base64,/, ""),
    "base64",
  );

  const W = 1200,
    H = 1700;

  const bubbles: [number, number][] = [
    [0, 1],
    [1, 0],
    [2, 3],
    [3, 2],
    [4, 1],
  ];
  // Positions match DEFAULT_BUBBLE_LAYOUT in process-answer-sheet.ts
  // startXPct=0.35, startYPct=0.05, spacingXPct=0.04, spacingYPct=0.018
  // QR goes to right half to avoid overlapping bubble area

  const overlays: sharp.OverlayOptions[] = [
    { input: qrPng, top: 40, left: 700 }, // QR on right side
  ];

  for (const [row, col] of bubbles) {
    const cx = Math.round(W * (0.35 + col * 0.04));
    const cy = Math.round(H * (0.05 + row * 0.018));
    // Sharp filled rect (no anti-aliasing issues)
    const black = await sharp({
      create: { width: 14, height: 14, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    overlays.push({ input: black, top: cy - 7, left: cx - 7 });
  }

  const sheet = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(overlays)
    .png()
    .toBuffer();

  const tmpDir = mkdtempSync("omr-verify-");
  const imagePath = join(tmpDir, "sheet.png");
  writeFileSync(imagePath, sheet);
  console.log("1. Page created (QR right, bubbles in grid)");

  const repo = inMemoryRepo() as ScanningRepository & { getLogs(): string[] };
  const qrDecoder: QrDecoder = {
    async decode(buffer: Buffer) {
      const decodeQR = (await import("qr/decode.js")).default;
      const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
      const text = decodeQR({ width: info.width, height: info.height, data });
      return text ? { text } : null;
    },
  };

  const mockQuestions = [
    { id: "q1", number: 1, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-fake" },
    { id: "q2", number: 2, correctAnswer: "A" as const, optionsLength: 4, bundleItemId: "bi-fake" },
    { id: "q3", number: 3, correctAnswer: "D" as const, optionsLength: 4, bundleItemId: "bi-fake" },
    { id: "q4", number: 4, correctAnswer: "C" as const, optionsLength: 4, bundleItemId: "bi-fake" },
    { id: "q5", number: 5, correctAnswer: "B" as const, optionsLength: 4, bundleItemId: "bi-fake" },
  ];

  const useCase = new ProcessAnswerSheet(repo, qrDecoder, {
    getCorrectAnswers: async () => mockQuestions,
    getCorrectAnswersForBundle: async () => [],
  });

  console.log("3. Processing…");
  const result = await useCase.execute({
    answerSheetId: SHEET_ID,
    scanBatchId: "batch-1",
    institutionId: "inst-1",
    imagePath,
  });

  console.log("4. Result:");
  if (result.ok) {
    console.log(`   OK: status=${result.status} score=${result.score}/${mockQuestions.length}`);
  } else {
    console.log(`   FAIL: ${result.error.code} — ${result.error.message}`);
  }

  console.log("5. Per-question log:");
  for (const line of repo.getLogs()) {
    console.log(`   ${line}`);
  }
}

main().catch(console.error);
