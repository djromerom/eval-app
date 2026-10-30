/**
 * Implementación Prisma del `ReglasConteoReader` (puerto en `application/`).
 *
 * Hace 2 queries (no N+1):
 *
 *   1. `EvaluationRule` de la institución con los joins de nombres
 *      (prueba, año, grado, asignatura, tipo de cuadernillo).
 *
 *   2. `Evaluation` de la institución (`parentVersionId: null` para contar
 *      solo la última versión de cada formulación, y `deletedAt: null`).
 *      Se proyecta curso/asignatura/tipo/prueba para indexar por la MISMA
 *      tupla que la regla y contarlas de un vistazo.
 *
 * Multi-tenant: ambas queries filtran por `institutionId` del actor.
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { ReglaConteoRow } from "../domain/queries/reglas-conteo/regla-conteo-row";
import type { ReglasConteoReader } from "../application/list-reglas-conteo";

/** Clave de la tupla que identifica una regla. El `_` es sentinel de
 *  "sin tipo de cuadernillo" (en la evaluación puede ser null). */
function tupleKey(
  periodId: string | null,
  courseId: string,
  subjectId: string,
  bookletTypeId: string | null,
): string {
  return `${periodId ?? "_"}|${courseId}|${subjectId}|${bookletTypeId ?? "_"}`;
}

export class PrismaReglasConteoReader implements ReglasConteoReader {
  async listByInstitution(institutionId: string): Promise<ReglaConteoRow[]> {
    // (1) Reglas + nombres.
    const rules = await prisma.evaluationRule.findMany({
      where: { institutionId },
      orderBy: [{ periodId: "asc" }, { courseId: "asc" }, { subjectId: "asc" }],
      select: {
        id: true,
        periodId: true,
        courseId: true,
        subjectId: true,
        bookletTypeId: true,
        exactQuestions: true,
        period: {
          select: {
            name: true,
            academicYear: { select: { year: true } },
          },
        },
        course: { select: { name: true } },
        subject: { select: { name: true } },
        bookletType: { select: { name: true } },
      },
    });
    if (rules.length === 0) return [];

    // (2) Formulaciones de la institución para contar cuántas lleva cada
    // regla. Solo la última versión de cada cadena (`parentVersionId: null`).
    const evaluations = await prisma.evaluation.findMany({
      where: {
        institutionId,
        deletedAt: null,
        parentVersionId: null,
      },
      select: {
        periodId: true,
        bookletTypeId: true,
        courseSubject: { select: { courseId: true, subjectId: true } },
      },
    });

    const formuladasByKey = new Map<string, number>();
    for (const e of evaluations) {
      const key = tupleKey(
        e.periodId,
        e.courseSubject.courseId,
        e.courseSubject.subjectId,
        e.bookletTypeId,
      );
      formuladasByKey.set(key, (formuladasByKey.get(key) ?? 0) + 1);
    }

    // (3) Mapping.
    return rules.map((r) => ({
      id: r.id,
      periodId: r.periodId,
      periodName: r.period.name,
      academicYearYear: r.period.academicYear.year,
      courseName: r.course.name,
      subjectName: r.subject.name,
      bookletTypeName: r.bookletType.name,
      exactQuestions: r.exactQuestions,
      formuladas:
        formuladasByKey.get(tupleKey(r.periodId, r.courseId, r.subjectId, r.bookletTypeId)) ?? 0,
    }));
  }
}
