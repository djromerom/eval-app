/**
 * Script de un solo uso para E2E local de la integración OMR Python.
 *
 *   1. Carga una hoja real desde `omr-poc/uploads/`.
 *   2. Renderiza encima un QR firmado por institución apuntando al
 *      AnswerSheet que vamos a crear (en el top-left, donde el
 *      `QrDecoder` lo busca primero).
 *   3. Crea in-memory: institución demo + Course/Group/Student + un
 *      Evaluation PUBLICADA con 110 questions cuya `correctAnswer`
 *      coincide con lo que el motor detecta en la muestra. Así el
 *      worker termina en `GRADED` (no REVIEW por mismatch) y se ven
 *      colores en la matriz.
 *   4. Persiste imagen compuesta en `storage/scans/<batchId>/...`.
 *   5. Crea `ScanBatch` + `AnswerSheet` (vía Prisma) y encola un job
 *      en `omr-scan`. El `worker-omr` corriendo lo procesa y, si todo
 *      cuadra, deja la hoja en GRADED con score.
 *
 * Reuso:
 *   - HMAC + QR vía `buildSignedQrContent` + `generateQrDataUrl`
 *     (mismas utilidades que usa la UI al imprimir el booklet).
 *
 * NO está pensado para correr más de una vez con la misma imagen sin
 * regenerar IDs (las preguntas se crean con `@@unique` por sectionId
 * + number); para re-correr, usar `--reset`.
 */

// Carga .env para procesos standalone (este script se invoca con `tsx`).
try {
  process.loadEnvFile(".env");
} catch {
  // Sin .env (CI, producción) usamos el entorno del proceso.
}
// Este script es un helper E2E fuera de los módulos; necesita Prisma para
// sembrar evaluation/estudiante y crear AnswerSheet + ScanBatch directo en
// la BD. La regla `no-restricted-imports` aplica la capa domain/application,
// no aplica aquí, pero el ESLint la chequea global; deshabilitamos esa regla
// concreta solo para este archivo.
// eslint-disable-next-line no-restricted-imports
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import QRCode from "qrcode";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  canonicalJson,
  deriveInstitutionSecret,
  signPayload,
} from "@/shared/infrastructure/crypto/hmac";
import { env } from "@/config/env";

const prisma = new PrismaClient();

// Argumentos: --reset (borra el batch anterior por nombre), --sample=<id8>
const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, "").split("=");
  // strip `--` prefix → "key"; v puede ser undefined si la flag va suelta
  args.set(k ?? "", v ?? "1");
}

// Cwd al lanzar `pnpm tsx scripts/...` es el root de `eval-app/`.
// `omr-poc/` vive un nivel arriba.
const SAMPLE = path.resolve(
  process.cwd(),
  "../omr-poc/uploads/b953479dd2bc4b7e96cd73aef511bed0.jpg",
);
const BATCH_NAME = "E2E-OMR-PYTHON";

// Esta hoja REAL tiene 110 preguntas tipo A-D. Para que el worker NO
// quede en REVIEW por mismatch, replicamos ese conteo en la clave.
// Las correctAnswer se eligen igual a lo que el motor devolvió en
// sanity-check (memo del log de /analyze): q1=B, q2=C, q3=C,
// q4-q110 alternando entre B/C mayoritariamente. Si esto difiere del
// motor, la hoja quedará REVIEW pero la matriz igualmente se carga.
const REAL_ANSWERS = ["B", "C", "C", ...(Array(107).fill("B") as string[])];

async function buildSignedQrPayload(opts: {
  institutionCode: string;
  studentCode: string;
  sheetId: string;
  evaluationId: string;
  ts: number;
}): Promise<string> {
  const payload = {
    inst: opts.institutionCode,
    student: opts.studentCode,
    sheet: opts.sheetId,
    ts: opts.ts,
    eval: opts.evaluationId,
  };
  const secret = deriveInstitutionSecret(env.QR_SIGNING_SECRET, opts.institutionCode);
  const sig = signPayload(payload, secret);
  return JSON.stringify({ ...JSON.parse(canonicalJson(payload)), sig });
}

async function renderQrPng(text: string, size: number): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: size,
  });
}

async function composeSheetWithQr(basePath: string, qrPng: Buffer): Promise<Buffer> {
  const base = await readFile(basePath);
  const meta = await sharp(base).metadata();
  const imgW = meta.width ?? 1704;
  const imgH = meta.height ?? 2200;

  // El QR decoder prioriza `tl-800→1200`: el QR debe quedar dentro de
  // los primeros ~250x250 px del top-left para decodificar al primer
  // intento. Con padding de 30 px y 220 px de lado queda cómodo.
  const qrSide = 220;
  const qrLeft = 30;
  const qrTop = 30;

  return sharp(base)
    .composite([{ input: qrPng, left: qrLeft, top: qrTop, blend: "over" }])
    .png()
    .toBuffer();
}

async function main() {
  const reset = args.has("reset");

  // ---------- Institución + admin + año académico (seed los crea si faltan) ----------
  const institution = await prisma.institution.upsert({
    where: { slug: "maria-doraliza" },
    update: {},
    create: {
      name: "I.E. María Doraliza López de Mejía",
      slug: "maria-doraliza",
      code: "MDLM",
    },
  });

  const admin = await prisma.user.findFirstOrThrow({
    where: { email: "admin@eval.local" },
  });

  const academicYear = await prisma.academicYear.upsert({
    where: { institutionId_year: { institutionId: institution.id, year: 2026 } },
    update: { isCurrent: true },
    create: {
      year: 2026,
      institutionId: institution.id,
      startDate: new Date(2026, 0, 15),
      endDate: new Date(2026, 10, 30),
      isCurrent: true,
    },
  });

  // ---------- Course (1°) + Group + Subject MAT ----------
  const course =
    (await prisma.course.findFirst({
      where: {
        institutionId: institution.id,
        academicYearId: academicYear.id,
        code: "11",
      },
    })) ??
    (await prisma.course.create({
      data: {
        institutionId: institution.id,
        academicYearId: academicYear.id,
        name: "11°",
        code: "11",
      },
    }));

  const subject =
    (await prisma.subject.findFirst({
      where: { code: "MAT", institutionId: null },
    })) ??
    (await prisma.subject.create({
      data: { name: "Matemáticas", code: "MAT", icon: "calculator" },
    }));

  const courseSubject = await prisma.courseSubject.upsert({
    where: { courseId_subjectId: { courseId: course.id, subjectId: subject.id } },
    update: {},
    create: { courseId: course.id, subjectId: subject.id },
  });

  const groupRow =
    (await prisma.group.findFirst({
      where: { institutionId: institution.id, courseId: course.id, name: "11-01" },
    })) ??
    (await prisma.group.create({
      data: { institutionId: institution.id, courseId: course.id, name: "11-01" },
    }));

  // ---------- Student único por institución+código ----------
  const studentCode = "E2E-001";
  let student = await prisma.student.findFirst({
    where: { institutionId: institution.id, code: studentCode },
  });
  if (!student) {
    student = await prisma.student.create({
      data: {
        institutionId: institution.id,
        code: studentCode,
        name: "Estudiante E2E",
        idType: "T.I.",
        idNumber: "1000000001",
        groupId: groupRow.id,
        enrollmentYear: 2026,
      },
    });
  }

  // ---------- Evaluation PUBLICADA con la clave de 110 preguntas ----------
  const evalTitle = "E2E OMR Python (110 items)";
  let evaluation = await prisma.evaluation.findFirst({
    where: { institutionId: institution.id, title: evalTitle, deletedAt: null },
  });
  if (!evaluation || reset) {
    if (reset && evaluation) {
      await prisma.evaluation.delete({ where: { id: evaluation.id } });
    }
    evaluation = await prisma.evaluation.create({
      data: {
        institutionId: institution.id,
        academicYearId: academicYear.id,
        courseSubjectId: courseSubject.id,
        teacherId: admin.id,
        title: evalTitle,
        description: "Generado por scripts/e2e-compose-omr.ts",
        status: "PUBLISHED",
        version: 1,
        totalQuestions: REAL_ANSWERS.length,
        durationMinutes: 90,
      },
    });
    // Sección única + preguntas + opciones en 3 pasos (createMany) — evita
    // los enojos del nested-create de Prisma con campos Json.
    await prisma.evaluationSection.create({
      data: {
        evaluationId: evaluation.id,
        order: 1,
        title: "Única",
        content: { type: "doc", content: [] },
      },
    });
    const section = await prisma.evaluationSection.findFirstOrThrow({
      where: { evaluationId: evaluation.id, order: 1 },
    });
    await prisma.question.createMany({
      data: REAL_ANSWERS.map((ans, i) => ({
        sectionId: section.id,
        number: i + 1,
        correctAnswer: ans,
        weight: 1,
        text: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: `Pregunta ${i + 1}` }] }],
        },
      })),
    });
    const questions = await prisma.question.findMany({
      where: { sectionId: section.id },
      orderBy: { number: "asc" },
    });
    for (const q of questions) {
      await prisma.questionOption.createMany({
        data: [
          { questionId: q.id, key: "A", text: { type: "doc", content: [] } },
          { questionId: q.id, key: "B", text: { type: "doc", content: [] } },
          { questionId: q.id, key: "C", text: { type: "doc", content: [] } },
          { questionId: q.id, key: "D", text: { type: "doc", content: [] } },
        ],
      });
    }
    console.log(`  ✔ Evaluation ${evaluation.id} (${REAL_ANSWERS.length} q)`);
  } else {
    console.log(`  ↺ Evaluation ${evaluation.id} (reusada)`);
  }

  // ---------- AnswerSheet + ScanBatch ----------
  // Primero creamos la hoja (sin imagen) para conocer su UUID (lo
  // incrusta el QR) y poder montar la imagen compuesta.
  const tempSheet = await prisma.answerSheet.create({
    data: {
      evaluationId: evaluation.id,
      studentId: student.id,
      qrContent: "",
      qrSignature: "",
      status: "PENDING",
    },
  });

  const qrText = await buildSignedQrPayload({
    institutionCode: institution.code,
    studentCode: student.code,
    sheetId: tempSheet.id,
    evaluationId: evaluation.id,
    ts: Date.now(),
  });

  const qrPng = await renderQrPng(qrText, 220);
  const composed = await composeSheetWithQr(SAMPLE, qrPng);

  // Batch por nombre (idempotencia): busco si ya hay uno PUBLISHED.
  let batch = await prisma.scanBatch.findFirst({
    where: {
      institutionId: institution.id,
      evaluationId: evaluation.id,
      uploadedBy: admin.id,
      status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (reset || !batch) {
    batch = await prisma.scanBatch.create({
      data: {
        institutionId: institution.id,
        evaluationId: evaluation.id,
        uploadedBy: admin.id,
        status: "PENDING",
        totalSheets: 1,
        processedSheets: 0,
      },
    });
    console.log(`  ✔ ScanBatch ${batch.id}`);
  } else {
    console.log(`  ↺ ScanBatch ${batch.id} (reusado)`);
  }

  const relPath = `scans/${batch.id}/sheet_${tempSheet.id.slice(0, 8)}.png`;
  const absPath = path.join(env.STORAGE_DIR, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await sharp(composed).toFile(absPath);

  // Actualizo la hoja apuntando al batch + imagen + QR persistido.
  await prisma.answerSheet.update({
    where: { id: tempSheet.id },
    data: {
      scanBatchId: batch.id,
      scannedImage: relPath,
      qrContent: qrText,
      qrSignature: (JSON.parse(qrText) as { sig: string }).sig,
    },
  });
  await prisma.scanBatch.update({
    where: { id: batch.id },
    data: { totalSheets: { increment: 1 } },
  });

  // ---------- Encolar el job ----------
  const conn = new IORedis("redis://localhost:6400", { maxRetriesPerRequest: null });
  const queue = new Queue("omr-scan", { connection: conn });
  const job = await queue.add(
    "omr-scan",
    {
      answerSheetId: tempSheet.id,
      scanBatchId: batch.id,
      institutionId: institution.id,
      imagePath: relPath,
    },
    { removeOnComplete: 50, removeOnFail: 50 },
  );
  console.log(`  ✔ Job OMR encolado: ${job.id}`);
  console.log(`    hoja: ${tempSheet.id}`);
  console.log(`    imagen: ${absPath}`);
  console.log(`    URL matriz: /teacher/scan/${batch.id}`);

  await queue.close();
  await conn.quit();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
