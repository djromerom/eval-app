/**
 * Implementación Prisma del `AsignacionesPendientesReader` (puerto en
 * `application/`).
 *
 * Una asignación pendiente es el trabajo que la prueba exige y que todavía no
 * tiene formulación detrás. Hay **dos fuentes** de ese trabajo:
 *
 *   1. La **regla de conteo** de la tupla (Prueba × Grado × Asignatura × Tipo
 *      de cuadernillo): dice cuántos ítems debe tener la formulación.
 *
 *   2. La **asignación docente** (Docente × Grado × Asignatura × Tipo de
 *      cuadernillo): dice quién tiene que formular. Una asignación con
 *      `bookletTypeId = null` aplica a cualquier tipo de cuadernillo.
 *
 *   3. El **catálogo del grado** (`CourseSubject`): la asignatura pertenece
 *      al grado y todavía no tiene ni docente ni regla. Solo se cuenta para
 *      los grados que la prueba ya toca (los que tienen reglas o docentes
 *      asignados): un grado ajeno a la prueba no genera trabajo en ella.
 *
 * Las asignaciones docente son de la institución (no de una prueba): cada
 * prueba necesita su propia formulación de cada una, así que una asignación
 * sin formular está pendiente en todas las pruebas donde no se ha formulado.
 *
 * Cuándo una tupla está pendiente:
 *   - tupla de regla (cuadernillo exacto): no hay formulación con esa misma
 *     tupla (misma prueba, grado, asignatura y cuadernillo);
 *   - tupla de asignación con cuadernillo: no hay formulación con ese
 *     cuadernillo;
 *   - tupla "cualquier tipo" (asignación o catálogo): no hay ninguna
 *     formulación de esa asignatura-grado en la prueba.
 *
 * Cuando la prueba tiene reglas para una asignatura-grado, las reglas mandan:
 * sus filas traen el cuadernillo y los ítems esperados, y los docentes de las
 * asignaciones se enganchan a la fila de su cuadernillo (los de "cualquier
 * tipo" se enganchan a todas las de esa asignatura). El catálogo solo aporta
 * la fila cuando la asignatura no tiene ni regla ni docente asignado.
 *
 * Cinco queries (no N+1) y un map final:
 *
 *   1. `Period` de la institución: las pruebas en las que hay trabajo.
 *   2. `EvaluationRule` de la institución: lo que cada prueba exige.
 *   3. `Evaluation` (cabezas de versión, no borradas): lo que ya está
 *      formulado.
 *   4. `TeacherSubjectAssignment` de la institución: los docentes asignados.
 *   5. `CourseSubject` de la institución: las asignaturas de cada grado.
 *
 * Multi-tenant: las queries se acotan por `institutionId` (directo en
 * periodos, reglas y evaluaciones; vía `course.institutionId` en las
 * asignaciones y en el catálogo).
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { AsignacionesPendientesReader } from "../application/list-asignaciones-pendientes";
import type { AsignacionPendiente } from "../domain/queries/formulaciones/asignacion-pendiente";

/** Sentinel para "sin tipo de cuadernillo" en la clave de tupla: la
 *  asignación aplica a cualquier cuadernillo. */
const CUALQUIER_TIPO = "-";

function claveTupla(courseId: string, subjectId: string, bookletTypeId: string | null): string {
  return `${courseId}|${subjectId}|${bookletTypeId ?? CUALQUIER_TIPO}`;
}

/** Tupla de trabajo dentro de una prueba, antes de saber si está formulada. */
interface TuplaTrabajo {
  courseId: string;
  courseName: string;
  subjectId: string;
  subjectName: string;
  bookletTypeId: string | null;
  bookletTypeName: string | null;
  /** Ítems exigidos por la regla de conteo. `null` = sin regla (la tupla
   *  viene solo de una asignación docente). */
  expected: number | null;
  /** Docentes asignados a la tupla. */
  teachers: string[];
}

export class PrismaAsignacionesPendientesReader implements AsignacionesPendientesReader {
  async listPending(institutionId: string): Promise<AsignacionPendiente[]> {
    // (1) Las pruebas de la institución.
    const periods = await prisma.period.findMany({
      where: { institutionId },
      select: {
        id: true,
        name: true,
        startDate: true,
        academicYear: { select: { year: true } },
      },
      orderBy: { startDate: "asc" },
    });
    if (periods.length === 0) return [];

    // (2) Lo que cada prueba exige (reglas de conteo).
    const rules = await prisma.evaluationRule.findMany({
      where: { institutionId },
      select: {
        id: true,
        exactQuestions: true,
        periodId: true,
        period: { select: { id: true, name: true } },
        course: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
        bookletType: { select: { id: true, name: true } },
      },
    });

    // (3) Lo que ya está formulado, por prueba.
    const evaluations = await prisma.evaluation.findMany({
      where: { institutionId, deletedAt: null, parentVersionId: null },
      select: {
        periodId: true,
        bookletTypeId: true,
        courseSubject: {
          select: { course: { select: { id: true } }, subject: { select: { id: true } } },
        },
      },
    });
    /** Por prueba: tuplas exactas (con cuadernillo) y asignaturas-grado
     *  (para las asignaciones "cualquier tipo"). */
    const formuladas = new Map<string, { exactas: Set<string>; asignaturas: Set<string> }>();
    for (const e of evaluations) {
      if (!e.periodId) continue;
      const bucket = formuladas.get(e.periodId) ?? {
        exactas: new Set<string>(),
        asignaturas: new Set<string>(),
      };
      const courseId = e.courseSubject.course.id;
      const subjectId = e.courseSubject.subject.id;
      bucket.exactas.add(claveTupla(courseId, subjectId, e.bookletTypeId));
      bucket.asignaturas.add(`${courseId}|${subjectId}`);
      formuladas.set(e.periodId, bucket);
    }

    // (4) Los docentes asignados, agrupados por grado-asignatura.
    const assignments = await prisma.teacherSubjectAssignment.findMany({
      where: { courseSubject: { course: { institutionId } } },
      select: {
        bookletTypeId: true,
        bookletType: { select: { name: true } },
        courseSubject: {
          select: {
            course: { select: { id: true, name: true } },
            subject: { select: { id: true, name: true } },
          },
        },
        teacher: { select: { user: { select: { name: true } } } },
      },
    });
    interface AsignacionDocente {
      courseId: string;
      courseName: string;
      subjectId: string;
      subjectName: string;
      bookletTypeId: string | null;
      bookletTypeName: string | null;
      teacherName: string;
    }
    const porAsignatura = new Map<string, AsignacionDocente[]>();
    for (const a of assignments) {
      const courseId = a.courseSubject.course.id;
      const subjectId = a.courseSubject.subject.id;
      const clave = `${courseId}|${subjectId}`;
      const list = porAsignatura.get(clave) ?? [];
      list.push({
        courseId,
        courseName: a.courseSubject.course.name,
        subjectId,
        subjectName: a.courseSubject.subject.name,
        bookletTypeId: a.bookletTypeId,
        bookletTypeName: a.bookletType?.name ?? null,
        teacherName: a.teacher.user.name,
      });
      porAsignatura.set(clave, list);
    }

    // (5) El catálogo de asignaturas por grado (`CourseSubject`): las
    //     asignaturas que el grado tiene y que todavía no tienen ni docente
    //     ni regla de conteo. También son trabajo pendiente de la prueba.
    const courseSubjects = await prisma.courseSubject.findMany({
      where: { course: { institutionId } },
      select: {
        id: true,
        course: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
      },
    });

    // (5) Por prueba: tuplas de trabajo y filtrado de las ya formuladas.
    const pendientes: { fila: AsignacionPendiente; startDate: number }[] = [];
    for (const period of periods) {
      const reglasDeLaPrueba = rules.filter((r) => r.periodId === period.id);
      const tuplas = new Map<string, TuplaTrabajo>();

      // (5a) Las reglas de conteo mandan: traen cuadernillo e ítems.
      for (const r of reglasDeLaPrueba) {
        tuplas.set(claveTupla(r.course.id, r.subject.id, r.bookletType.id), {
          courseId: r.course.id,
          courseName: r.course.name,
          subjectId: r.subject.id,
          subjectName: r.subject.name,
          bookletTypeId: r.bookletType.id,
          bookletTypeName: r.bookletType.name,
          expected: r.exactQuestions,
          teachers: [],
        });
      }

      // (5b) Las asignaciones docente: los docentes se enganchan a la fila
      //      de su cuadernillo; si la prueba no tiene reglas para esa
      //      asignatura-grado, la asignación crea la tupla.
      for (const lista of porAsignatura.values()) {
        const primera = lista[0]!;
        const reglasDeLaAsignatura = reglasDeLaPrueba.filter(
          (r) => r.course.id === primera.courseId && r.subject.id === primera.subjectId,
        );

        if (reglasDeLaAsignatura.length > 0) {
          for (const a of lista) {
            const objetivos = a.bookletTypeId
              ? reglasDeLaAsignatura.filter((r) => r.bookletType.id === a.bookletTypeId)
              : reglasDeLaAsignatura;
            for (const r of objetivos) {
              const tupla = tuplas.get(claveTupla(r.course.id, r.subject.id, r.bookletType.id));
              if (tupla && !tupla.teachers.includes(a.teacherName)) {
                tupla.teachers.push(a.teacherName);
              }
            }
          }
          continue;
        }

        // Sin reglas: los cuadernillos de la asignación definen las tuplas.
        // "Cualquier tipo" solo crea fila propia si no hay ningún cuadernillo
        // específico: si lo hay, sus docentes se enganchan a esas filas (el
        // docente asignado a "cualquier tipo" formula en cualquier cuadernillo).
        const cuadernillos = new Map<string | null, string | null>();
        for (const a of lista) {
          if (a.bookletTypeId !== null) cuadernillos.set(a.bookletTypeId, a.bookletTypeName);
        }
        if (cuadernillos.size === 0) cuadernillos.set(null, null);
        for (const [bookletTypeId, bookletTypeName] of cuadernillos) {
          const key = claveTupla(primera.courseId, primera.subjectId, bookletTypeId);
          const tupla: TuplaTrabajo = tuplas.get(key) ?? {
            courseId: primera.courseId,
            courseName: primera.courseName,
            subjectId: primera.subjectId,
            subjectName: primera.subjectName,
            bookletTypeId,
            bookletTypeName,
            expected: null,
            teachers: [],
          };
          for (const a of lista) {
            // Un docente con "cualquier tipo" aplica a todos los cuadernillos
            // de la asignatura-grado.
            if (a.bookletTypeId === bookletTypeId || a.bookletTypeId === null) {
              if (!tupla.teachers.includes(a.teacherName)) tupla.teachers.push(a.teacherName);
            }
          }
          tuplas.set(key, tupla);
        }
      }

      // (5c) El catálogo del grado: las asignaturas que el grado tiene y que
      //      no tienen ni regla de conteo ni docente asignado también están
      //      pendientes. Solo para los grados que la prueba ya toca (los que
      //      tienen reglas o docentes asignados): un grado ajeno a la prueba
      //      no genera trabajo en ella.
      const gradosDeLaPrueba = new Set<string>([
        ...reglasDeLaPrueba.map((r) => r.course.id),
        ...[...porAsignatura.values()].flat().map((a) => a.courseId),
      ]);
      for (const cs of courseSubjects) {
        if (!gradosDeLaPrueba.has(cs.course.id)) continue;
        const claveAsignatura = `${cs.course.id}|${cs.subject.id}`;
        // Si la prueba ya tiene una regla o hay docente asignado, esas filas
        // representan el trabajo: no se duplica.
        if (
          reglasDeLaPrueba.some(
            (r) => r.course.id === cs.course.id && r.subject.id === cs.subject.id,
          )
        ) {
          continue;
        }
        if (porAsignatura.has(claveAsignatura)) continue;
        const key = claveTupla(cs.course.id, cs.subject.id, null);
        if (tuplas.has(key)) continue;
        tuplas.set(key, {
          courseId: cs.course.id,
          courseName: cs.course.name,
          subjectId: cs.subject.id,
          subjectName: cs.subject.name,
          bookletTypeId: null,
          bookletTypeName: null,
          expected: null,
          teachers: [],
        });
      }

      // (5d) ¿Cuál de esas tuplas sigue sin formular?
      const bucket = formuladas.get(period.id);
      for (const tupla of tuplas.values()) {
        const formulada =
          tupla.bookletTypeId === null
            ? (bucket?.asignaturas.has(`${tupla.courseId}|${tupla.subjectId}`) ?? false)
            : (bucket?.exactas.has(
                claveTupla(tupla.courseId, tupla.subjectId, tupla.bookletTypeId),
              ) ?? false);
        if (formulada) continue;

        pendientes.push({
          startDate: period.startDate.getTime(),
          fila: {
            id: `${period.id}:${claveTupla(tupla.courseId, tupla.subjectId, tupla.bookletTypeId)}`,
            subjectName: tupla.subjectName,
            courseName: tupla.courseName,
            academicYearYear: period.academicYear.year,
            periodId: period.id,
            periodName: period.name,
            bookletTypeId: tupla.bookletTypeId,
            bookletTypeName: tupla.bookletTypeName,
            itemsExpected: tupla.expected,
            assignedTeachers: tupla.teachers,
          },
        });
      }
    }

    // Orden estable: por inicio de la prueba, luego grado, asignatura y
    // cuadernillo.
    pendientes.sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate - b.startDate;
      const ca = a.fila.courseName.localeCompare(b.fila.courseName, "es");
      if (ca !== 0) return ca;
      const sa = a.fila.subjectName.localeCompare(b.fila.subjectName, "es");
      if (sa !== 0) return sa;
      return (a.fila.bookletTypeName ?? "").localeCompare(b.fila.bookletTypeName ?? "", "es");
    });

    return pendientes.map((p) => p.fila);
  }
}
