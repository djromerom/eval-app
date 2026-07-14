/**
 * Seed de la evaluación "Prueba I Final de Periodo — Cuadernillo 3" extraída
 * del PDF de referencia `Prueba__11º_I_periodo_C3__1_.pdf`. Sirve como
 * fixture reproducible para:
 *
 *   1. Validación de la plantilla de impresión (render contra el spec §3.4).
 *   2. Diff visual entre el PDF generado y la referencia.
 *   3. Carga realista del banco de preguntas en el editor (modo diseñador).
 *
 * Idempotente: busca la evaluación por (institutionId, title, bookletNumber);
 * si existe, NO la recrea (re-correr el seed deja la BD igual).
 *
 * Datos faltantes conocidos: las preguntas 278, 282, 285, 293, 294 y 321 del
 * PDF original están en la maqueta de dos columnas que pdftotext no separa
 * limpiamente. La diferencia (6 / 110 = 5.4%) es aceptable para el objetivo
 * de comparación visual. Si hacen falta, se pueden agregar manualmente desde
 * el editor y re-correr el diff.
 *
 * Ejecutar:
 *   pnpm seed         # corre prisma/seed.ts (institución demo + admin + año)
 *   pnpm tsx prisma/seed-reference-evaluation.ts
 *   # o agregar al package.json un script "seed:reference".
 */
import { PrismaClient, RoleType, type SoloLevel } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

const SEED_PATH = join(__dirname, "seeds", "reference-evaluation.json");
const LOGO_PATH = join(__dirname, "assets", "maria-doraliza-logo.png");

interface SeedQuestion {
  number: number;
  text: unknown; // TipTap JSON
  options: { key: string; text: unknown }[];
  correctAnswer: string;
  competency: string;
  soloLevel: SoloLevel;
}

interface SeedSection {
  title: string;
  order: number;
  questions: SeedQuestion[];
}

interface SeedData {
  institutionSlug: string;
  title: string;
  description: string;
  bookletNumber: number;
  sectionSubjectMap: Record<string, string>;
  missingNumbers: number[];
  sections: SeedSection[];
}

function main() {
  const data: SeedData = JSON.parse(readFileSync(SEED_PATH, "utf-8"));

  return run(data).finally(() => prisma.$disconnect());
}

async function run(data: SeedData) {
  const institution = await prisma.institution.findUnique({
    where: { slug: data.institutionSlug },
  });
  if (!institution) {
    throw new Error(
      `Institución ${data.institutionSlug} no encontrada. Corre primero \`pnpm db:seed\`.`,
    );
  }
  // Captura local para que TS no pierda el narrowing dentro de awaits y closures.
  const institutionId = institution.id;

  // 1. Subir el logo al path de assets. Solo lo hacemos la primera vez;
  //    si Institution.logo ya está poblado, lo respetamos.
  if (!institution.logo && existsSync(LOGO_PATH)) {
    const logo = readFileSync(LOGO_PATH);
    const dest = join(
      process.env.STORAGE_DIR ?? "./storage",
      "institutions",
      institutionId,
      "logo.png",
    );
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(process.env.STORAGE_DIR ?? "./storage", "institutions", institutionId), {
      recursive: true,
    });
    writeFileSync(dest, logo);
    await prisma.institution.update({
      where: { id: institutionId },
      data: { logo: dest },
    });
    console.log(`✔ Logo subido: ${dest}`);
  }

  // 2. Año académico (reusar el actual del seed principal; crear si falta).
  const currentYear = new Date().getFullYear();
  const academicYear = await prisma.academicYear.upsert({
    where: { institutionId_year: { institutionId, year: currentYear } },
    update: {},
    create: {
      year: currentYear,
      institutionId,
      startDate: new Date(currentYear, 0, 15),
      endDate: new Date(currentYear, 10, 30),
      isCurrent: true,
    },
  });

  // 3. Curso 11° (uno por institución/año). Buscar primero porque no hay @@unique.
  let course = await prisma.course.findFirst({
    where: {
      institutionId,
      academicYearId: academicYear.id,
      name: "11°",
    },
    select: { id: true },
  });
  if (!course) {
    course = await prisma.course.create({
      data: {
        name: "11°",
        code: "11",
        institutionId,
        academicYearId: academicYear.id,
      },
      select: { id: true },
    });
  }

  // 4. Asignaturas. Ciencias Sociales ya existe globalmente (CSO); Humanidades
  //    e Integrada las creamos como locales a la institución.
  async function ensureSubject(name: string, code: string): Promise<{ id: string; name: string }> {
    const existing = await prisma.subject.findFirst({
      where: {
        OR: [
          { institutionId: null, code },
          { institutionId, code },
        ],
      },
    });
    if (existing) return { id: existing.id, name: existing.name };
    const created = await prisma.subject.create({
      data: { name, code, institutionId },
    });
    return { id: created.id, name: created.name };
  }

  const subjectsByName: Record<string, { id: string; name: string }> = {};
  const uniqueSubjectNames = Array.from(new Set(Object.values(data.sectionSubjectMap)));
  const codeMap: Record<string, string> = {
    "Ciencias Sociales": "CSO",
    Humanidades: "HUM",
    Integrada: "INT",
  };
  for (const subjectName of uniqueSubjectNames) {
    subjectsByName[subjectName] = await ensureSubject(subjectName, codeMap[subjectName] ?? "X");
  }

  // 5. CourseSubject: una por (course, subject).
  async function ensureCourseSubject(subjectId: string): Promise<string> {
    const existing = await prisma.courseSubject.findFirst({
      where: { courseId: course!.id, subjectId },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.courseSubject.create({
      data: { courseId: course!.id, subjectId },
    });
    return created.id;
  }

  // courseSubjectId por título de sección.
  const sectionCS: Record<string, string> = {};
  for (const [sectionTitle, subjectName] of Object.entries(data.sectionSubjectMap)) {
    const subj = subjectsByName[subjectName]!;
    sectionCS[sectionTitle] = await ensureCourseSubject(subj.id);
  }

  // 6. Periodo: reusar el primero si existe; crear uno de "Final" si no.
  let period = await prisma.period.findFirst({
    where: { institutionId, academicYearId: academicYear.id },
    orderBy: { order: "asc" },
  });
  if (!period) {
    period = await prisma.period.create({
      data: {
        name: "Final",
        order: 1,
        institutionId,
        academicYearId: academicYear.id,
        startDate: new Date(currentYear, 8, 1),
        endDate: new Date(currentYear, 10, 30),
      },
    });
  }

  // 7. Docente: reusa el admin del seed principal (tiene rol TEACHER).
  const teacher = await prisma.user.findFirst({
    where: {
      institutionId,
      roles: { some: { role: RoleType.TEACHER } },
    },
  });
  if (!teacher) throw new Error("No hay usuario con rol TEACHER. Corre pnpm db:seed primero.");

  // 8. ¿Ya existe la evaluación? Si sí, no la recreamos.
  const existing = await prisma.evaluation.findFirst({
    where: {
      institutionId,
      title: data.title,
      bookletNumber: data.bookletNumber,
    },
    include: { sections: { include: { questions: { include: { options: true } } } } },
  });

  if (existing) {
    console.log(
      `↩ Evaluación ya existe (id=${existing.id}); no se recrea. ` +
        `Tiene ${existing.sections.length} bloques, ${existing.totalQuestions} preguntas.`,
    );
    console.log(`  Faltantes conocidos en fuente: ${data.missingNumbers.join(", ")}`);
    return;
  }

  // 9. Crear evaluación + secciones + preguntas + opciones en una transacción.
  const evaluation = await prisma.$transaction(async (tx) => {
    const evalRow = await tx.evaluation.create({
      data: {
        title: data.title,
        description: data.description,
        bookletNumber: data.bookletNumber,
        status: "PUBLISHED", // para que isPrintable() sea true y se pueda descargar/visualizar
        institutionId: institution.id,
        academicYearId: academicYear.id,
        periodId: period!.id,
        teacherId: teacher.id,
        courseSubjectId: sectionCS[data.sections[0]!.title]!, // se sobreescribe por sección
        totalQuestions: 0, // se actualiza al final
      },
    });

    let runningNumber = 0;
    for (const section of data.sections) {
      const sectionRow = await tx.evaluationSection.create({
        data: {
          evaluationId: evalRow.id,
          title: section.title,
          content: { type: "doc", content: [{ type: "paragraph" }] }, // bloque vacío: las preguntas llevan su propio contexto
          order: section.order,
        },
      });
      for (const q of section.questions) {
        runningNumber += 1;
        const questionRow = await tx.question.create({
          data: {
            sectionId: sectionRow.id,
            number: q.number,
            text: q.text as object,
            correctAnswer: q.correctAnswer,
            soloLevel: q.soloLevel,
            competency: q.competency,
            weight: 1.0,
          },
        });
        for (const opt of q.options) {
          await tx.questionOption.create({
            data: {
              questionId: questionRow.id,
              key: opt.key,
              text: opt.text as object,
            },
          });
        }
      }
    }

    await tx.evaluation.update({
      where: { id: evalRow.id },
      data: {
        totalQuestions: runningNumber,
        courseSubjectId: sectionCS[data.sections[0]!.title]!,
      },
    });

    return evalRow;
  });

  const totalQuestions = data.sections.reduce((acc, s) => acc + s.questions.length, 0);
  console.log(`✔ Evaluación creada: ${evaluation.title}`);
  console.log(`  ID: ${evaluation.id}`);
  console.log(
    `  Bloques: ${data.sections.map((s) => `${s.title}(${s.questions.length})`).join(", ")}`,
  );
  console.log(`  Total preguntas: ${totalQuestions}`);
  console.log(`  Faltantes en fuente (no en BD): ${data.missingNumbers.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
