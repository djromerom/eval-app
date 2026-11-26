/**
 * Implementación Prisma del `PendientesCalificacionReader` (puerto en
 * `application/`).
 *
 * Queries acotadas, sin N+1: grupo(s) y prueba, estudiantes, hojas de esos
 * estudiantes en la prueba, cuadernillos de la prueba y las respuestas de esas
 * hojas. La consolidación vive en el dominio (`consolidarPendientes`), acá solo
 * se carga.
 *
 * **Dos alcances, la misma carga:**
 *   - `cargarDatos` → un grupo (la vista en pantalla). Los cuadernillos que
 *     "se esperan" son los READY de ese grado.
 *   - `listPendientesDePrueba` → todos los grados de la prueba (el Excel). Los
 *     cuadernillos que se esperan son los READY de todos los grados, y cada
 *     estudiante se compara contra los de SU grado (lo hace el dominio, vía
 *     `courseId`).
 *
 * **Solo hojas de cuadernillo.** Las hojas que cuelgan de una evaluación
 * legacy (`AnswerSheet.evaluationId`) no se cuentan: el camino canónico desde
 * el Sprint 1 es el cuadernillo, y una evaluación suelta que se "espera" de
 * todos los del grado generaría filas de "sin hoja" que nadie puede resolver.
 * Es la misma decisión que toma el informe por grupo.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  DatosPendientes,
  PendientesCalificacionReader,
} from "../application/list-pendientes-calificacion";
import type {
  CuadernilloPendiente,
  EstudiantePendiente,
  HojaPendiente,
} from "../domain/queries/pendientes-calificacion/consolidar";
import type { OpcionesPruebaGrupo } from "../domain/shared/opciones-prueba-grupo";

/** Grupo con el curso al que pertenece (el grado). */
interface GrupoAlcance {
  id: string;
  name: string;
  courseId: string;
  course: { name: string; academicYearId: string };
}

/** Prueba con su año académico. */
interface PruebaAlcance {
  id: string;
  name: string;
  academicYearId: string;
  academicYear: { year: number };
}

/** Orden de los cuadernillos: número de cuadernillo, luego creación, luego id. */
function ordenarCuadernillos<
  T extends { bookletNumber: number | null; createdAt: Date; id: string },
>(cuadernillos: readonly T[]): T[] {
  return [...cuadernillos].sort(
    (a, b) =>
      (a.bookletNumber ?? Number.MAX_SAFE_INTEGER) - (b.bookletNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

export class PrismaPendientesCalificacionReader implements PendientesCalificacionReader {
  async listOpciones(institutionId: string, courseIds?: string[]): Promise<OpcionesPruebaGrupo> {
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
  ): Promise<DatosPendientes | null> {
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
        select: {
          id: true,
          name: true,
          academicYearId: true,
          academicYear: { select: { year: true } },
        },
      }),
    ]);
    if (!grupo || !prueba) return null;

    // Un solo grupo: los cuadernillos que se esperan son los de su grado.
    const datos = await this.cargar(institutionId, [grupo], grupo.courseId, prueba);
    return datos[0] ?? null;
  }

  async listPendientesDePrueba(
    institutionId: string,
    periodId: string,
    courseIds?: string[],
  ): Promise<{ periodo: { id: string; name: string }; datos: DatosPendientes[] }> {
    const [grupos, prueba] = await Promise.all([
      courseIds && courseIds.length === 0
        ? Promise.resolve([])
        : prisma.group.findMany({
            where: { institutionId, ...(courseIds ? { courseId: { in: courseIds } } : {}) },
            select: {
              id: true,
              name: true,
              courseId: true,
              course: { select: { name: true, academicYearId: true } },
            },
          }),
      prisma.period.findFirst({
        where: { id: periodId, institutionId },
        select: {
          id: true,
          name: true,
          academicYearId: true,
          academicYear: { select: { year: true } },
        },
      }),
    ]);
    if (!prueba) return { periodo: { id: periodId, name: "" }, datos: [] };
    if (grupos.length === 0) return { periodo: { id: prueba.id, name: prueba.name }, datos: [] };

    // Orden del Excel: por grado y luego por grupo, con collation numérica
    // ("10" antes que "2"), como el listado de opciones.
    const gruposOrdenados = [...grupos].sort(
      (a, b) =>
        a.course.name.localeCompare(b.course.name, "es", { numeric: true }) ||
        a.name.localeCompare(b.name, "es", { numeric: true }),
    );

    // Todos los grados: los cuadernillos que se esperan son los READY de
    // cualquier curso de la prueba (el dominio los filtra por el grado de
    // cada estudiante).
    const datos = await this.cargar(institutionId, gruposOrdenados, null, prueba);
    return { periodo: { id: prueba.id, name: prueba.name }, datos };
  }

  /**
   * Carga compartida por los dos alcances. Devuelve un `DatosPendientes` por
   * grupo: el número de lista es la posición dentro del grupo, así que la
   * consolidación tiene que correr por grupo.
   */
  private async cargar(
    institutionId: string,
    grupos: GrupoAlcance[],
    courseIdDeCuadernillos: string | null,
    prueba: PruebaAlcance,
  ): Promise<DatosPendientes[]> {
    const grupoIds = grupos.map((g) => g.id);

    const estudiantes = await prisma.student.findMany({
      where: { institutionId, groupId: { in: grupoIds } },
      select: {
        id: true,
        code: true,
        lastName1: true,
        lastName2: true,
        firstName1: true,
        firstName2: true,
        isActive: true,
        deletedAt: true,
        bookletTypeId: true,
        group: { select: { id: true, courseId: true } },
      },
    });
    const studentIds = estudiantes.map((e) => e.id);

    const hojas =
      studentIds.length === 0
        ? []
        : await prisma.answerSheet.findMany({
            where: {
              studentId: { in: studentIds },
              bundle: { institutionId, periodId: prueba.id },
            },
            select: {
              id: true,
              bundleId: true,
              studentId: true,
              updatedAt: true,
              createdAt: true,
              score: true,
              totalCorrect: true,
              totalQuestions: true,
              status: true,
            },
          });

    const bundleIdsDeHojas = [
      ...new Set(hojas.map((h) => h.bundleId).filter((b): b is string => b !== null)),
    ];

    const dondeCuadernillo: Prisma.EvaluationBundleWhereInput = {
      institutionId,
      periodId: prueba.id,
      // Los READY: un DRAFT no se imprimió y sería una columna siempre vacía.
      // Por hojas: cualquiera, para no perder hojas ya escaneadas.
      OR: [
        courseIdDeCuadernillos === null
          ? { status: "READY" }
          : { courseId: courseIdDeCuadernillos, status: "READY" },
        { id: { in: bundleIdsDeHojas } },
      ],
    };

    const cuadernillos = await prisma.evaluationBundle.findMany({
      where: dondeCuadernillo,
      select: {
        id: true,
        name: true,
        bookletNumber: true,
        bookletTypeId: true,
        courseId: true,
        status: true,
        createdAt: true,
        items: {
          orderBy: { order: "asc" },
          select: {
            evaluation: {
              select: {
                courseSubject: {
                  select: { subject: { select: { name: true, shortName: true } } },
                },
              },
            },
          },
        },
      },
    });

    // Respuestas de las hojas: hace falta saber cuántas tienen opción marcada.
    const idsHojas = hojas.map((h) => h.id);
    const respuestas =
      idsHojas.length === 0
        ? []
        : await prisma.studentAnswer.findMany({
            where: { answerSheetId: { in: idsHojas } },
            select: { answerSheetId: true, selectedKey: true },
          });

    const marcadasPorHoja = new Map<string, number>();
    const totalPorHoja = new Map<string, number>();
    for (const r of respuestas) {
      totalPorHoja.set(r.answerSheetId, (totalPorHoja.get(r.answerSheetId) ?? 0) + 1);
      // `selectedKey` es `null` cuando el motor no vio marca ("BLANCO") o vio
      // varias ("MULTIPLE"). El literal "BLANCO" se acepta por si quedó en
      // datos viejos.
      const marcada = r.selectedKey !== null && r.selectedKey !== "" && r.selectedKey !== "BLANCO";
      if (marcada)
        marcadasPorHoja.set(r.answerSheetId, (marcadasPorHoja.get(r.answerSheetId) ?? 0) + 1);
    }

    const hojasMapeadas: HojaPendiente[] = hojas.map((h) => ({
      id: h.id,
      studentId: h.studentId ?? "",
      bundleId: h.bundleId ?? "",
      updatedAt: h.updatedAt,
      score: h.score,
      totalCorrect: h.totalCorrect,
      totalQuestions: h.totalQuestions,
      status: h.status,
      createdAt: h.createdAt,
      marcadas: marcadasPorHoja.get(h.id) ?? 0,
      totalRespuestas: totalPorHoja.get(h.id) ?? 0,
    }));

    const cuadernillosMapeados: CuadernilloPendiente[] = ordenarCuadernillos(cuadernillos).map(
      (c) => ({
        id: c.id,
        name: c.name,
        bookletTypeId: c.bookletTypeId,
        asignaturas: c.items.map(
          (it) =>
            it.evaluation.courseSubject.subject.shortName?.trim() ||
            it.evaluation.courseSubject.subject.name,
        ),
        courseId: c.courseId,
        listo: c.status === "READY",
      }),
    );

    const estudiantesPorGrupo = new Map<string, EstudiantePendiente[]>();
    const grupoPorEstudiante = new Map<string, string>();
    for (const e of estudiantes) {
      const grupoId = e.group?.id ?? "";
      const cursoId = e.group?.courseId ?? "";
      grupoPorEstudiante.set(e.id, grupoId);
      const lista = estudiantesPorGrupo.get(grupoId) ?? [];
      lista.push({
        id: e.id,
        code: e.code,
        lastName1: e.lastName1,
        lastName2: e.lastName2,
        firstName1: e.firstName1,
        firstName2: e.firstName2,
        activo: e.isActive && e.deletedAt === null,
        bookletTypeId: e.bookletTypeId,
        courseId: cursoId,
      });
      estudiantesPorGrupo.set(grupoId, lista);
    }

    const hojasPorGrupo = new Map<string, HojaPendiente[]>();
    for (const h of hojasMapeadas) {
      const grupoId = grupoPorEstudiante.get(h.studentId);
      if (!grupoId) continue;
      const lista = hojasPorGrupo.get(grupoId) ?? [];
      lista.push(h);
      hojasPorGrupo.set(grupoId, lista);
    }

    return grupos.map((g) => ({
      prueba: {
        id: prueba.id,
        name: prueba.name,
        year: prueba.academicYear.year,
        academicYearId: prueba.academicYearId,
      },
      grupo: {
        id: g.id,
        name: g.name,
        courseName: g.course.name,
        courseId: g.courseId,
        academicYearId: g.course.academicYearId,
      },
      estudiantes: estudiantesPorGrupo.get(g.id) ?? [],
      cuadernillos: cuadernillosMapeados,
      hojas: hojasPorGrupo.get(g.id) ?? [],
    }));
  }
}
