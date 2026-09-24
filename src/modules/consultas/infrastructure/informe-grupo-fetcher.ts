/**
 * Implementación Prisma del `InformeGrupoReader` (puerto en `application/`).
 *
 * Seis queries acotadas, sin N+1: grupo y prueba, estudiantes del grupo,
 * hojas de esos estudiantes en cuadernillos de la prueba, cuadernillos (con
 * sus formulaciones → asignatura), inhabilitadas en lote y respuestas solo de
 * las hojas vigentes y calificadas. La consolidación vive en el dominio
 * (`consolidarInformeGrupo`), acá solo se carga.
 *
 * **Qué cuadernillos entran.** Los de la prueba cuyo grado es el del grupo,
 * más cualquier cuadernillo de la prueba en el que un estudiante del grupo
 * tenga una hoja (cuadernillos sin grado, o un estudiante que presentó el de
 * otro grado). Así se consolidan todos los del grado sin perder hojas.
 *
 * **Estudiantes.** Se traen TODOS los del grupo, incluidos retirados: el
 * número de lista se calcula igual que en la hoja impresa
 * (`print/answer-sheets/bundle/[id]`), que tampoco filtra. El dominio lista
 * solo los activos.
 *
 * **Tenant.** Grupo, prueba, estudiantes y cuadernillos se filtran por
 * `institutionId`; las hojas y respuestas cuelgan de esos cuadernillos.
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { DatosInformeGrupo, InformeGrupoReader } from "../application/informe-grupo";
import type { InformeGrupoOpciones } from "../domain/queries/informe-grupo/informe-grupo";
import { claveInhabilitada, hojasVigentes } from "../domain/queries/informe-grupo/consolidar";

export class PrismaInformeGrupoReader implements InformeGrupoReader {
  async listOpciones(institutionId: string, courseIds?: string[]): Promise<InformeGrupoOpciones> {
    const [periodos, grupos] = await Promise.all([
      prisma.period.findMany({
        where: { institutionId },
        select: {
          id: true,
          name: true,
          isCurrent: true,
          academicYearId: true,
          academicYear: { select: { year: true, isCurrent: true } },
        },
        orderBy: [{ academicYear: { year: "desc" } }, { order: "asc" }],
      }),
      courseIds && courseIds.length === 0
        ? Promise.resolve([])
        : prisma.group.findMany({
            where: { institutionId, ...(courseIds ? { courseId: { in: courseIds } } : {}) },
            select: {
              id: true,
              name: true,
              course: { select: { name: true, academicYearId: true } },
            },
          }),
    ]);

    return {
      pruebas: periodos.map((p) => ({
        id: p.id,
        name: p.name,
        academicYearId: p.academicYearId,
        year: p.academicYear.year,
        isCurrent: p.isCurrent,
        yearIsCurrent: p.academicYear.isCurrent,
      })),
      grupos: grupos
        .map((g) => ({
          id: g.id,
          name: g.name,
          courseName: g.course.name,
          academicYearId: g.course.academicYearId,
        }))
        .sort(
          (a, b) =>
            a.courseName.localeCompare(b.courseName, "es", { numeric: true }) ||
            a.name.localeCompare(b.name, "es", { numeric: true }),
        ),
    };
  }

  async cargarDatos(
    institutionId: string,
    periodId: string,
    groupId: string,
  ): Promise<DatosInformeGrupo | null> {
    const [grupo, prueba] = await Promise.all([
      prisma.group.findFirst({
        where: { id: groupId, institutionId },
        select: {
          id: true,
          name: true,
          courseId: true,
          course: { select: { name: true, academicYearId: true } },
        },
      }),
      prisma.period.findFirst({
        where: { id: periodId, institutionId },
        select: { id: true, name: true, academicYearId: true },
      }),
    ]);
    if (!grupo || !prueba) return null;

    const estudiantes = await prisma.student.findMany({
      where: { institutionId, groupId },
      select: {
        id: true,
        code: true,
        lastName1: true,
        lastName2: true,
        firstName1: true,
        firstName2: true,
        isActive: true,
        deletedAt: true,
      },
    });
    const studentIds = estudiantes.map((e) => e.id);

    const hojas =
      studentIds.length === 0
        ? []
        : await prisma.answerSheet.findMany({
            where: {
              studentId: { in: studentIds },
              bundle: { institutionId, periodId },
            },
            select: { id: true, bundleId: true, studentId: true, updatedAt: true, score: true },
          });

    const bundleIdsDeHojas = [...new Set(hojas.map((h) => h.bundleId).filter((b) => b !== null))];
    const cuadernillos = await prisma.evaluationBundle.findMany({
      where: {
        institutionId,
        periodId,
        // Del grado: solo los READY (un DRAFT no se escanea y sería una columna
        // siempre vacía). Por hojas: cualquiera, para no perder notas.
        OR: [{ courseId: grupo.courseId, status: "READY" }, { id: { in: bundleIdsDeHojas } }],
      },
      select: {
        id: true,
        name: true,
        bookletNumber: true,
        createdAt: true,
        items: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            evaluation: {
              select: {
                courseSubject: {
                  select: {
                    subject: { select: { id: true, name: true, code: true, shortName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const bundleIds = cuadernillos.map((c) => c.id);

    const hojasInforme = hojas
      .filter((h): h is typeof h & { bundleId: string; studentId: string } =>
        Boolean(h.bundleId && h.studentId),
      )
      .map((h) => ({
        id: h.id,
        bundleId: h.bundleId,
        studentId: h.studentId,
        updatedAt: h.updatedAt,
        calificada: h.score !== null,
      }));
    const idsQueCuentan = hojasVigentes(hojasInforme)
      .filter((h) => h.calificada)
      .map((h) => h.id);

    const [inhabilitadas, respuestas] = await Promise.all([
      bundleIds.length === 0
        ? Promise.resolve([])
        : prisma.disabledBundleQuestion.findMany({
            where: { bundleId: { in: bundleIds }, disabled: true },
            select: { bundleId: true, questionId: true },
          }),
      idsQueCuentan.length === 0
        ? Promise.resolve([])
        : prisma.studentAnswer.findMany({
            where: { answerSheetId: { in: idsQueCuentan } },
            select: { answerSheetId: true, bundleItemId: true, questionId: true, isCorrect: true },
          }),
    ]);

    return {
      prueba,
      grupo: {
        id: grupo.id,
        name: grupo.name,
        courseId: grupo.courseId,
        courseName: grupo.course.name,
        academicYearId: grupo.course.academicYearId,
      },
      estudiantes: estudiantes.map((e) => ({
        id: e.id,
        code: e.code,
        lastName1: e.lastName1,
        lastName2: e.lastName2,
        firstName1: e.firstName1,
        firstName2: e.firstName2,
        activo: e.isActive && e.deletedAt === null,
      })),
      cuadernillos: cuadernillos.map((c) => ({
        id: c.id,
        name: c.name,
        bookletNumber: c.bookletNumber,
        createdAt: c.createdAt,
        items: c.items.map((it) => ({
          id: it.id,
          order: it.order,
          subject: it.evaluation.courseSubject.subject,
        })),
      })),
      hojas: hojasInforme,
      respuestas,
      inhabilitadas: new Set(inhabilitadas.map((d) => claveInhabilitada(d.bundleId, d.questionId))),
    };
  }
}
