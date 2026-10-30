/**
 * Implementación Prisma del `FormuladoresReader` (puerto en `application/`).
 *
 * Hace 2 queries (no N+1) y 1 map final:
 *
 *   1. `TeacherSubjectAssignment` de la institución, con el tipo de
 *      cuadernillo, el grado, la asignatura y la ficha del docente
 *      (`Teacher.idType/idNumber/phone` + `User.name/email`).
 *
 *   2. `Evaluation` (última versión: `parentVersionId: null`) con el autor,
 *      el tipo de cuadernillo y el cuadernillo (compendio) al que pertenece.
 *
 * El cruce entre ambos conjuntos vive en el dominio
 * (`domain/queries/formuladores/cobertura.ts`), como función pura y testeable
 * sin BD: aquí solo se traduce de Prisma a los tipos de entrada.
 *
 * Multi-tenant: las asignaciones se filtran por `courseSubject.course.
 * institutionId` (la tabla `TeacherSubjectAssignment` no lleva institutionId
 * propio) y las evaluaciones por `Evaluation.institutionId`.
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { FormuladorRow } from "../domain/queries/formuladores/formulador-row";
import {
  construirFilasFormuladores,
  type AsignacionDocente,
  type FormulacionDocente,
} from "../domain/queries/formuladores/cobertura";
import type { FormuladoresReader } from "../application/list-formuladores";

export class PrismaFormuladoresReader implements FormuladoresReader {
  async listByInstitution(institutionId: string): Promise<FormuladorRow[]> {
    const [assignments, evaluations] = await Promise.all([
      // (1) Asignaciones docente ↔ grado-asignatura ↔ tipo de cuadernillo.
      prisma.teacherSubjectAssignment.findMany({
        where: { courseSubject: { course: { institutionId } } },
        select: {
          id: true,
          bookletTypeId: true,
          bookletType: { select: { name: true, period: { select: { name: true } } } },
          courseSubject: {
            select: {
              id: true,
              course: {
                select: { name: true, academicYear: { select: { year: true } } },
              },
              subject: { select: { name: true } },
            },
          },
          teacher: {
            select: {
              idType: true,
              idNumber: true,
              phone: true,
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      }),
      // (2) Formulaciones (última versión) con su autor y su cuadernillo.
      prisma.evaluation.findMany({
        where: { institutionId, deletedAt: null, parentVersionId: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          courseSubjectId: true,
          bookletTypeId: true,
          period: { select: { name: true } },
          academicYear: { select: { year: true } },
          courseSubject: {
            select: {
              course: { select: { name: true } },
              subject: { select: { name: true } },
            },
          },
          teacher: {
            select: {
              id: true,
              name: true,
              email: true,
              teacherProfile: { select: { idType: true, idNumber: true, phone: true } },
            },
          },
          bundleItems: { select: { bundle: { select: { name: true } } } },
        },
      }),
    ]);

    const asignaciones: AsignacionDocente[] = assignments.map((a) => ({
      id: a.id,
      tipoCuadernilloId: a.bookletTypeId,
      tipoCuadernillo: a.bookletType?.name ?? null,
      prueba: a.bookletType?.period.name ?? null,
      anio: a.courseSubject.course.academicYear.year,
      grado: a.courseSubject.course.name,
      asignatura: a.courseSubject.subject.name,
      courseSubjectId: a.courseSubject.id,
      docenteId: a.teacher.user.id,
      docenteNombre: a.teacher.user.name,
      tipoDocumento: a.teacher.idType,
      documento: a.teacher.idNumber,
      email: a.teacher.user.email,
      celular: a.teacher.phone,
    }));

    const formulaciones: FormulacionDocente[] = evaluations.map((e) => {
      const perfil = e.teacher.teacherProfile;
      const bundleName = e.bundleItems[0]?.bundle.name;
      return {
        id: e.id,
        titulo: e.title,
        courseSubjectId: e.courseSubjectId,
        tipoCuadernilloId: e.bookletTypeId,
        prueba: e.period?.name ?? null,
        anio: e.academicYear.year,
        grado: e.courseSubject.course.name,
        asignatura: e.courseSubject.subject.name,
        autorId: e.teacher.id,
        autorNombre: e.teacher.name,
        email: e.teacher.email,
        tipoDocumento: perfil?.idType ?? null,
        documento: perfil?.idNumber ?? null,
        celular: perfil?.phone ?? null,
        // Mismo criterio que la consulta de calificaciones: el nombre del
        // cuadernillo si la formulación ya está en uno; si no, el título.
        cuadernillo: bundleName ?? e.title,
      };
    });

    return construirFilasFormuladores(asignaciones, formulaciones);
  }
}
