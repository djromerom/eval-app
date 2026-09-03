/**
 * Implementación Prisma del `FormulacionesReader` (puerto en `application/`).
 *
 * Hace 3 queries (no N+1) y 1 map final:
 *
 *   1. Evaluations con todos los joins para asignatura/grado/periodo/cuadernillo/
 *      año/docente autor + `parentVersionId: null` para "última versión".
 *
 *   2. `TeacherSubjectAssignment` filtrado por los `courseSubjectId` distintos
 *      del paso 1. Incluye `teacher.user.name` para proyectar los nombres
 *      directamente, sin paso intermedio por `Teacher`.
 *
 *   3. `EvaluationRule` por `institutionId` (tabla chica, ≤ cientos de filas
 *      por institución). Se indexa por la tupla
 *      `${periodId}|${courseId}|${subjectId}|${bookletTypeId}` para lookup O(1)
 *      por fila.
 *
 * El mapping final aplica `computeItemsBadge` (puro) y empaqueta el row.
 *
 * Multi-tenant: el `Evaluation.institutionId` ya viene en la query del paso 1;
 * los pasos 2 y 3 se cruzan contra courseSubject / institutionId que ya están
 * restringidos por la 1. Defensivo contra RLS inactiva (ver
 * `src/shared/infrastructure/db/tenant-context.ts`).
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import { computeItemsBadge } from "../domain/shared/items-badge";
import type { FormulacionRow } from "../domain/queries/formulaciones/formulacion-row";
import type { FormulacionesReader } from "../application/list-formulaciones";

/** Clave de la regla: nullable por ambos lados (periodId y bookletTypeId pueden
 *  ser null en la evaluation). Distinguimos explícitamente "null" de "undefined". */
function ruleKey(
  periodId: string | null,
  courseId: string,
  subjectId: string,
  bookletTypeId: string | null,
): string {
  return `${periodId ?? "_"}|${courseId}|${subjectId}|${bookletTypeId ?? "_"}`;
}

export class PrismaFormulacionesReader implements FormulacionesReader {
  async listByInstitution(institutionId: string): Promise<FormulacionRow[]> {
    // (1) Evaluations + joins base.
    const evaluations = await prisma.evaluation.findMany({
      where: {
        institutionId,
        deletedAt: null,
        // "Última versión": solo las cabezas de la cadena de versiones.
        // Sprint ago 2026: cada aprobación crea una nueva fila con
        // parentVersionId → la cabeza; las anteriores quedan como histórico.
        parentVersionId: null,
      },
      orderBy: { updatedAt: "desc" },
      include: {
        courseSubject: {
          include: {
            course: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true } },
          },
        },
        period: { select: { id: true, name: true } },
        bookletType: { select: { id: true, name: true } },
        academicYear: { select: { year: true } },
        teacher: { select: { name: true } },
      },
    });
    if (evaluations.length === 0) return [];

    const courseSubjectIds = Array.from(new Set(evaluations.map((e) => e.courseSubjectId)));

    // (2) Docentes asignados por courseSubjectId. Un solo `findMany` batch.
    const assignments = await prisma.teacherSubjectAssignment.findMany({
      where: { courseSubjectId: { in: courseSubjectIds } },
      select: {
        courseSubjectId: true,
        teacher: { select: { user: { select: { name: true } } } },
      },
    });
    // Agrupa por courseSubjectId → string[] de nombres únicos (un docente
    // puede estar asignado 2 veces a la misma tupla? no — hay unique
    // (teacherId, courseSubjectId) — pero por defensa hacemos dedupe).
    const teachersByCourseSubject = new Map<string, string[]>();
    for (const a of assignments) {
      const name = a.teacher.user.name;
      const list = teachersByCourseSubject.get(a.courseSubjectId) ?? [];
      if (!list.includes(name)) list.push(name);
      teachersByCourseSubject.set(a.courseSubjectId, list);
    }

    // (3) Reglas de la institución. Tabla chica — un único fetch vale.
    const rules = await prisma.evaluationRule.findMany({
      where: { institutionId },
      select: {
        periodId: true,
        courseId: true,
        subjectId: true,
        bookletTypeId: true,
        exactQuestions: true,
      },
    });
    const expectedByKey = new Map<string, number>();
    for (const r of rules) {
      expectedByKey.set(
        ruleKey(r.periodId, r.courseId, r.subjectId, r.bookletTypeId),
        r.exactQuestions,
      );
    }

    // (4) Mapping.
    return evaluations.map<FormulacionRow>((e) => {
      const expected =
        expectedByKey.get(
          ruleKey(e.periodId, e.courseSubject.courseId, e.courseSubject.subjectId, e.bookletTypeId),
        ) ?? null;
      return {
        id: e.id,
        title: e.title,
        subjectName: e.courseSubject.subject.name,
        courseName: e.courseSubject.course.name,
        academicYearYear: e.academicYear.year,
        periodId: e.periodId,
        periodName: e.period?.name ?? null,
        bookletTypeId: e.bookletTypeId,
        bookletTypeName: e.bookletType?.name ?? null,
        status: e.status as EvaluationStatus,
        authorName: e.teacher.name,
        assignedTeachers: teachersByCourseSubject.get(e.courseSubjectId) ?? [],
        itemsTotal: e.totalQuestions,
        itemsExpected: expected,
        itemsBadge: computeItemsBadge(e.totalQuestions, expected),
        updatedAt: e.updatedAt,
      };
    });
  }
}
