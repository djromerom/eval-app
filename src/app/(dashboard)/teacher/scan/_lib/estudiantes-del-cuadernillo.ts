import { prisma } from "@/shared/infrastructure/db/prisma";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";
import type { StudentOption } from "../[batchId]/[sheetId]/asignar-estudiante-button";

/** Estudiantes activos de los cursos que cubre el cuadernillo, en el formato
 *  del selector de estudiante. Misma consulta que el detalle de la hoja
 *  (`[sheetId]/page.tsx`). Vacío si el cuadernillo no es de la institución. */
export async function estudiantesDelCuadernillo(
  institutionId: string,
  bundleId: string,
): Promise<StudentOption[]> {
  const items = await prisma.evaluationBundleItem.findMany({
    where: { bundleId, bundle: { institutionId } },
    select: { evaluation: { select: { courseSubject: { select: { courseId: true } } } } },
  });
  const courseIds = [...new Set(items.map((i) => i.evaluation.courseSubject.courseId))];
  if (courseIds.length === 0) return [];

  const students = await prisma.student.findMany({
    where: {
      institutionId,
      isActive: true,
      deletedAt: null,
      group: { courseId: { in: courseIds } },
    },
    select: {
      id: true,
      code: true,
      lastName1: true,
      lastName2: true,
      firstName1: true,
      firstName2: true,
      group: { select: { name: true } },
    },
    orderBy: [{ lastName1: "asc" }, { lastName2: "asc" }, { firstName1: "asc" }],
  });
  return students.map((s) => ({
    id: s.id,
    code: s.code,
    name: nombreCompleto(s),
    groupName: s.group.name,
  }));
}
