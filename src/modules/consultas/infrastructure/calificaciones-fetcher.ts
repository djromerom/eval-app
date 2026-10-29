/**
 * Implementación Prisma del `CalificacionesReader` (puerto en `application/`).
 *
 * Una sola query con joins; sin N+1. Las decisiones que no son obvias:
 *
 * **Tenant.** `AnswerSheet` no tiene `institutionId` propio. El check
 * `AnswerSheet_target_xor_chk` garantiza que siempre cuelga de exactamente uno
 * entre `bundle` y `evaluation`, y ambos sí lo tienen: por ahí se filtra.
 *
 * **Solo hojas identificadas.** Una hoja cuyo QR no se resolvió no es la
 * calificación de nadie: se atiende en la revisión del lote, no acá.
 * Filtrarlas en la base (y no en la UI) mantiene el recorte del líder donde
 * corresponde. Las pendientes SÍ llegan, con su estado, para que el filtro de
 * la UI pueda encontrarlas.
 *
 * **Una fila por estudiante y prueba: la última modificada.** Un reescaneo, un
 * reproceso o una corrección generan hojas nuevas para el mismo estudiante —
 * en los datos de prueba hay un estudiante con 14 hojas del mismo cuadernillo
 * y puntajes entre 17 y 32. Sin deduplicar, el listado deja de ser un boletín
 * y se vuelve un historial. Se conserva la de `updatedAt` más reciente, que es
 * "lo último que alguien tocó".
 *
 * La deduplicación se hace en memoria y no con un `DISTINCT ON`: el filtro de
 * tenant y el recorte por grados ya corrieron en SQL, así que lo que llega
 * está acotado, y reescribir en SQL crudo los seis joins de esta query (grupo,
 * curso, cuadernillo, formulación, periodo, tipo) cambiaría seguridad de tipos
 * por un ahorro que a esta escala no se nota.
 *
 * **Grado de la hoja** = el grado del estudiante (`student.group.course`),
 * que es lo que un líder tiene asignado. Al exigir estudiante, ese camino
 * existe siempre: `Student.groupId` y `Group.courseId` son obligatorios, así
 * que no hay filas sin grado y no hace falta cascada de respaldo.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CalificacionRow,
  EntradaHistorial,
} from "../domain/queries/calificaciones/calificacion-row";
import { calcularPuntaje } from "../domain/queries/calificaciones/puntaje";
import { estadoDeHoja } from "../domain/queries/calificaciones/estado";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";
import type { CalificacionesReader } from "../application/list-calificaciones";

export class PrismaCalificacionesReader implements CalificacionesReader {
  async listByInstitution(institutionId: string, courseIds?: string[]): Promise<CalificacionRow[]> {
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
        updatedAt: true,
        studentId: true,
        bundleId: true,
        evaluationId: true,
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
      // Descendente por `updatedAt`: al deduplicar, la primera de cada grupo
      // es la vigente.
      orderBy: { updatedAt: "desc" },
    });

    // Agrupamos por estudiante + prueba. `bundleId ?? evaluationId` alcanza
    // como identificador de la prueba: el check XOR del esquema garantiza que
    // exactamente uno está definido.
    //
    // Las hojas descartadas no se tiran: quedan como historial de la fila, que
    // es lo que permite explicar por qué se reporta esta nota y no otra. Como
    // la query ya viene ordenada por `updatedAt` descendente, el primero de
    // cada grupo es el vigente y el resto queda cronológico.
    const grupos = new Map<string, typeof hojas>();
    for (const h of hojas) {
      const clave = `${h.studentId}|${h.bundleId ?? h.evaluationId}`;
      grupos.set(clave, [...(grupos.get(clave) ?? []), h]);
    }
    const ultimas = [...grupos.values()];

    return ultimas.map((hojasDelEstudiante) => {
      const h = hojasDelEstudiante[0]!;
      const historial: EntradaHistorial[] = hojasDelEstudiante.map((x, i) => ({
        sheetId: x.id,
        batchId: x.scanBatchId,
        fecha: x.updatedAt,
        estado: estadoDeHoja(x.score, x.status),
        puntaje: x.score === null ? null : calcularPuntaje(x.totalCorrect, x.totalQuestions),
        totalCorrect: x.totalCorrect,
        totalQuestions: x.totalQuestions,
        vigente: i === 0,
      }));
      // `studentId: { not: null }` en el where garantiza los dos, pero Prisma
      // no lo puede expresar en el tipo: el guard mantiene el map total.
      const alumno = h.student;
      if (!alumno) throw new Error(`hoja ${h.id} sin estudiante pese al filtro`);
      const grupo = alumno.group;

      // `calcularPuntaje` devuelve null si falta el puntaje o el total: es
      // exactamente el caso "pendiente", así que no hay que cortar nada.
      const puntaje = h.score === null ? null : calcularPuntaje(h.totalCorrect, h.totalQuestions);

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
        totalCorrect: h.totalCorrect,
        totalQuestions: h.totalQuestions,
        puntaje,
        estado: estadoDeHoja(h.score, h.status),
        scannedAt: h.createdAt,
        historial,
      } satisfies CalificacionRow;
    });
  }
}
