/**
 * Implementación Prisma del `CalificacionesReader` (puerto en `application/`).
 *
 * Una sola query con joins; sin N+1. Las decisiones que no son obvias:
 *
 * **Tenant.** `AnswerSheet` no tiene `institutionId` propio. El check
 * `AnswerSheet_target_xor_chk` garantiza que siempre cuelga de exactamente uno
 * entre `bundle` y `evaluation`, y ambos sí lo tienen: por ahí se filtra.
 *
 * **Solo hojas identificadas.** La consulta es de calificaciones por
 * estudiante, así que una hoja cuyo QR no se pudo resolver no es una fila:
 * es un problema de escaneo, y se atiende en el módulo de revisión de lotes.
 * Filtrarlas acá (y no en la UI) mantiene el recorte del líder en la base.
 *
 * **Grado de la hoja** = el grado del estudiante (`student.group.course`),
 * que es lo que un líder tiene asignado. Al exigir estudiante, ese camino
 * existe siempre: `Student.groupId` y `Group.courseId` son obligatorios, así
 * que no hay filas sin grado y no hace falta cascada de respaldo.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { CalificacionRow } from "../domain/queries/calificaciones/calificacion-row";
import { calcularPuntaje } from "../domain/queries/calificaciones/puntaje";
import type { CalificacionesReader } from "../application/list-calificaciones";

/** "APELLIDO1 APELLIDO2, NOMBRE1 NOMBRE2" sin dobles espacios ni comas sueltas
 *  cuando faltan los campos opcionales. */
function nombreCompleto(s: {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
}): string {
  const apellidos = [s.lastName1, s.lastName2].filter(Boolean).join(" ").trim();
  const nombres = [s.firstName1, s.firstName2].filter(Boolean).join(" ").trim();
  return [apellidos, nombres].filter(Boolean).join(", ");
}

export class PrismaCalificacionesReader implements CalificacionesReader {
  async listByInstitution(
    institutionId: string,
    courseIds?: string[],
  ): Promise<CalificacionRow[]> {
    const delTenant: Prisma.AnswerSheetWhereInput = {
      OR: [{ bundle: { institutionId } }, { evaluation: { institutionId } }],
      // Sin estudiante no hay calificación que reportar (ver cabecera).
      studentId: { not: null },
    };

    const delAlcance: Prisma.AnswerSheetWhereInput | undefined = courseIds
      ? { student: { group: { courseId: { in: courseIds } } } }
      : undefined;

    const hojas = await prisma.answerSheet.findMany({
      where: delAlcance ? { AND: [delTenant, delAlcance] } : delTenant,
      select: {
        id: true,
        scanBatchId: true,
        status: true,
        score: true,
        totalCorrect: true,
        totalQuestions: true,
        createdAt: true,
        student: {
          select: {
            code: true,
            lastName1: true,
            lastName2: true,
            firstName1: true,
            firstName2: true,
            group: {
              select: { id: true, name: true, courseId: true, course: { select: { name: true } } },
            },
          },
        },
        evaluation: {
          select: {
            title: true,
            periodId: true,
            period: { select: { name: true } },
            bookletTypeId: true,
            bookletType: { select: { name: true } },
          },
        },
        bundle: {
          select: {
            name: true,
            periodId: true,
            period: { select: { name: true } },
            bookletTypeId: true,
            bookletType: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return hojas.map((h) => {
      // `studentId: { not: null }` en el where garantiza los dos, pero Prisma
      // no lo puede expresar en el tipo: el guard mantiene el map total.
      const alumno = h.student;
      if (!alumno) throw new Error(`hoja ${h.id} sin estudiante pese al filtro`);
      const grupo = alumno.group;

      // `score` no se expone (guarda el conteo crudo de aciertos, igual que
      // `totalCorrect`), pero sigue siendo la señal de "ya fue calificada":
      // el status puede quedar en COMPLETED tras una revisión manual.
      const graded = h.score !== null;
      const puntaje = graded ? calcularPuntaje(h.totalCorrect, h.totalQuestions) : null;

      // Prueba y tipo salen de donde cuelga la hoja. El check XOR garantiza
      // que sea exactamente uno de los dos, asi que no hay ambiguedad.
      const prueba = h.bundle ?? h.evaluation;

      return {
        sheetId: h.id,
        batchId: h.scanBatchId,
        studentName: nombreCompleto(alumno),
        studentCode: alumno.code,
        courseId: grupo.courseId,
        courseName: grupo.course.name,
        groupId: grupo.id,
        groupName: grupo.name,
        assessmentName: h.bundle?.name ?? h.evaluation?.title ?? "—",
        periodId: prueba?.periodId ?? null,
        periodName: prueba?.period?.name ?? null,
        bookletTypeId: prueba?.bookletTypeId ?? null,
        bookletTypeName: prueba?.bookletType?.name ?? null,
        status: h.status,
        graded,
        totalCorrect: h.totalCorrect,
        totalQuestions: h.totalQuestions,
        puntaje,
        scannedAt: h.createdAt,
      } satisfies CalificacionRow;
    });
  }
}
