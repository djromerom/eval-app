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
 *
 * Alcance por grado: `courseIds` acota el paso 1 a los grados del ECU_LIDER.
 * Los pasos 2 y 3 no necesitan recorte: se derivan de las filas ya acotadas
 * (las reglas se indexan por tupla, así que solo se usan las de las filas que
 * se están mostrando).
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

/**
 * Docentes asignados a una formulación.
 *
 * Cuenta los que tienen una asignación para esa asignatura-grado **con ese
 * tipo de cuadernillo** y los que la tienen "para cualquier tipo"
 * (`bookletTypeId = null`). Así el docente del cuadernillo Especial no
 * aparece como asignado en la formulación del Estándar.
 */
function assignedTeachersFor(
  teachersByKey: Map<string, string[]>,
  courseSubjectId: string,
  bookletTypeId: string | null,
): string[] {
  const names = new Set<string>();
  for (const key of [`${courseSubjectId}|${bookletTypeId ?? "_"}`, `${courseSubjectId}|_`]) {
    for (const name of teachersByKey.get(key) ?? []) names.add(name);
  }
  return [...names];
}

export class PrismaFormulacionesReader implements FormulacionesReader {
  async listByInstitution(institutionId: string, courseIds?: string[]): Promise<FormulacionRow[]> {
    // (1) Evaluations + joins base.
    const evaluations = await prisma.evaluation.findMany({
      where: {
        institutionId,
        deletedAt: null,
        // "Última versión": solo las cabezas de la cadena de versiones.
        // Sprint ago 2026: cada aprobación crea una nueva fila con
        // parentVersionId → la cabeza; las anteriores quedan como histórico.
        parentVersionId: null,
        // ECU_LIDER: solo las formulaciones de los grados que tiene
        // asignados. El recorte va en la query, no en la UI: las filas de
        // otros grados nunca llegan al cliente.
        ...(courseIds ? { courseSubject: { courseId: { in: courseIds } } } : {}),
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

    // (2) Docentes asignados por courseSubjectId + tipo de cuadernillo. Un
    // solo `findMany` batch.
    const assignments = await prisma.teacherSubjectAssignment.findMany({
      where: { courseSubjectId: { in: courseSubjectIds } },
      select: {
        courseSubjectId: true,
        // `null` = la asignación aplica a cualquier tipo de cuadernillo.
        bookletTypeId: true,
        teacher: { select: { user: { select: { name: true } } } },
      },
    });
    // Agrupa por (courseSubjectId, bookletTypeId) → string[] de nombres
    // únicos. La clave usa "_" como sentinel de "sin tipo" (asignación que
    // aplica a cualquier cuadernillo), igual que `ruleKey` más abajo.
    const teachersByKey = new Map<string, string[]>();
    for (const a of assignments) {
      const key = `${a.courseSubjectId}|${a.bookletTypeId ?? "_"}`;
      const name = a.teacher.user.name;
      const list = teachersByKey.get(key) ?? [];
      if (!list.includes(name)) list.push(name);
      teachersByKey.set(key, list);
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
        assignedTeachers: assignedTeachersFor(teachersByKey, e.courseSubjectId, e.bookletTypeId),
        itemsTotal: e.totalQuestions,
        itemsExpected: expected,
        itemsBadge: computeItemsBadge(e.totalQuestions, expected),
        updatedAt: e.updatedAt,
      };
    });
  }
}
