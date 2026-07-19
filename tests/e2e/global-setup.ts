import { PrismaClient, RoleType, SoloLevel } from "@prisma/client";

/**
 * Global setup de Playwright: garantiza que existe la institución demo, el
 * usuario admin@eval.local con sus 4 roles, y UNA evaluación PUBLICADA con
 * una sección y dos preguntas — suficiente para que los flujos de descarga
 * de PDF y vista de impresión tengan datos reales.
 *
 * Idempotente: si los datos ya existen, no los duplica.
 *
 * Variables de entorno esperadas (cargadas por Playwright desde .env):
 *   DATABASE_URL
 *   SEED_ADMIN_PASSWORD (opcional; default "Admin1234!")
 */
export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 10);

    // Institución demo.
    const institution = await prisma.institution.upsert({
      where: { slug: "maria-doraliza" },
      update: {},
      create: {
        name: "I.E. María Doraliza López de Mejía",
        slug: "maria-doraliza",
        code: "MDLM",
      },
    });

    // Admin con 4 roles (campo User.password, no passwordHash).
    const admin = await prisma.user.upsert({
      where: { email: "admin@eval.local" },
      update: { password: passwordHash, institutionId: institution.id },
      create: {
        email: "admin@eval.local",
        name: "Super Administrador",
        password: passwordHash,
        institutionId: institution.id,
        roles: {
          create: [
            { role: RoleType.SUPER_ADMIN },
            { role: RoleType.ECU_MASTER },
            { role: RoleType.COORDINATOR },
            { role: RoleType.TEACHER },
          ],
        },
      },
    });
    for (const role of [RoleType.ECU_MASTER, RoleType.COORDINATOR, RoleType.TEACHER] as const) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: admin.id, role } },
        update: {},
        create: { userId: admin.id, role },
      });
    }

    // Año académico actual.
    const currentYear = new Date().getFullYear();
    const academicYear = await prisma.academicYear.upsert({
      where: { institutionId_year: { institutionId: institution.id, year: currentYear } },
      update: { isCurrent: true },
      create: {
        institutionId: institution.id,
        year: currentYear,
        startDate: new Date(currentYear, 0, 15),
        endDate: new Date(currentYear, 10, 30),
        isCurrent: true,
      },
    });

    // Si ya existe la evaluación demo, terminamos.
    const existingEval = await prisma.evaluation.findFirst({
      where: { teacherId: admin.id, title: "E2E Demo — Prueba 1" },
      select: { id: true },
    });
    if (existingEval) {
      console.log(`✔ globalSetup: evaluación demo ya existe (${existingEval.id})`);
      return;
    }

    // Curso: findFirst o create.
    let course = await prisma.course.findFirst({
      where: { institutionId: institution.id, name: "11°" },
    });
    if (!course) {
      course = await prisma.course.create({
        data: {
          institutionId: institution.id,
          name: "11°",
          code: "E2E-11",
          academicYearId: academicYear.id,
        },
      });
    }

    // Asignatura global MAT.
    const subject = await prisma.subject.findFirstOrThrow({
      where: { code: "MAT", institutionId: null },
    });

    // CourseSubject: findFirst o create.
    let courseSubject = await prisma.courseSubject.findFirst({
      where: { courseId: course.id, subjectId: subject.id },
    });
    if (!courseSubject) {
      courseSubject = await prisma.courseSubject.create({
        data: {
          courseId: course.id,
          subjectId: subject.id,
        },
      });
    }

    // Periodo: filter por academicYearId.
    let period = await prisma.period.findFirst({
      where: { academicYearId: academicYear.id, name: "Periodo 1" },
    });
    if (!period) {
      period = await prisma.period.create({
        data: {
          institutionId: institution.id,
          academicYearId: academicYear.id,
          name: "Periodo 1",
          order: 1,
          startDate: new Date(currentYear, 0, 15),
          endDate: new Date(currentYear, 3, 30),
        },
      });
    }

    // Crea la evaluación + sección + preguntas + opciones en una transacción.
    const newEvaluationId = await prisma.$transaction(async (tx) => {
      const evaluation = await tx.evaluation.create({
        data: {
          institutionId: institution.id,
          teacherId: admin.id,
          courseSubjectId: courseSubject.id,
          periodId: period.id,
          academicYearId: academicYear.id,
          title: "E2E Demo — Prueba 1",
          status: "PUBLISHED",
          version: 1,
          bookletNumber: 1,
        },
      });

      const section = await tx.evaluationSection.create({
        data: {
          evaluationId: evaluation.id,
          order: 0,
          title: "Bloque de preguntas",
          content: { type: "doc", content: [] },
        },
      });

      await tx.question.create({
        data: {
          sectionId: section.id,
          number: 1,
          text: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "¿Cuánto es 2 + 2?" }] },
            ],
          },
          correctAnswer: "B",
          soloLevel: SoloLevel.RELACIONAL,
          menComponent: "NUMÉRICO",
          options: {
            create: [
              {
                key: "A",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "3" }] }],
                },
              },
              {
                key: "B",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "4" }] }],
                },
              },
              {
                key: "C",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "5" }] }],
                },
              },
              {
                key: "D",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "22" }] }],
                },
              },
            ],
          },
        },
      });

      await tx.question.create({
        data: {
          sectionId: section.id,
          number: 2,
          text: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Capital de Colombia" }] },
            ],
          },
          correctAnswer: "B",
          soloLevel: SoloLevel.RELACIONAL,
          options: {
            create: [
              {
                key: "A",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Medellín" }] }],
                },
              },
              {
                key: "B",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Bogotá" }] }],
                },
              },
              {
                key: "C",
                text: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "Cali" }] }],
                },
              },
              {
                key: "D",
                text: {
                  type: "doc",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "Barranquilla" }] },
                  ],
                },
              },
            ],
          },
        },
      });

      return evaluation.id;
    });

    console.log(`✔ globalSetup: evaluación demo creada (${newEvaluationId})`);
  } finally {
    await prisma.$disconnect();
  }
}
