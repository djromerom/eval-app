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
 *      Se proyecta curso/asignatura/tipo/prueba y el número de ítems para
 *      indexar por la MISMA tupla que la regla y sumar sus ítems de un
 *      vistazo.
 *
 * Multi-tenant: ambas queries filtran por `institutionId` del actor.
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { ReglaConteoRow } from "../domain/queries/reglas-conteo/regla-conteo-row";
import {
  sumItemsPorTupla,
  tupleKey,
  type FormulacionItems,
} from "../domain/queries/reglas-conteo/items-por-tupla";
import type { ReglasConteoReader } from "../application/list-reglas-conteo";

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

    // (2) Formulaciones de la institución: los ítems (preguntas) que ya
    // existen para cada tupla. Solo la última versión de cada cadena
    // (`parentVersionId: null`).
    const evaluations = await prisma.evaluation.findMany({
      where: {
        institutionId,
        deletedAt: null,
        parentVersionId: null,
      },
      select: {
        periodId: true,
        bookletTypeId: true,
        totalQuestions: true,
        courseSubject: { select: { courseId: true, subjectId: true } },
      },
    });

    const formulaciones: FormulacionItems[] = evaluations.map((e) => ({
      periodId: e.periodId,
      courseId: e.courseSubject.courseId,
      subjectId: e.courseSubject.subjectId,
      bookletTypeId: e.bookletTypeId,
      totalQuestions: e.totalQuestions,
    }));
    const itemsPorTupla = sumItemsPorTupla(formulaciones);

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
      itemsFormulados:
        itemsPorTupla.get(tupleKey(r.periodId, r.courseId, r.subjectId, r.bookletTypeId)) ?? 0,
    }));
  }
}
