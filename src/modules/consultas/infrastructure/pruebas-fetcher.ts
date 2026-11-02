/**
 * Implementación Prisma del `PruebasReader` (puerto en `application/`).
 *
 * Una sola query: los periodos de la institución con el año académico anidado
 * (para el año y para el flag de "año actual"). Mismo `orderBy` que el
 * informe por grupo (año desc, `order` asc), así las dos consultas muestran
 * las pruebas en el mismo orden.
 *
 * Multi-tenant: el filtro es por `institutionId` (el del actor).
 */
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { PruebasReader } from "../application/list-pruebas";
import type { PruebaOpcion } from "../domain/shared/prueba-opcion";

export class PrismaPruebasReader implements PruebasReader {
  async listByInstitution(institutionId: string): Promise<PruebaOpcion[]> {
    const rows = await prisma.period.findMany({
      where: { institutionId },
      select: {
        id: true,
        name: true,
        isCurrent: true,
        academicYearId: true,
        academicYear: { select: { year: true, isCurrent: true } },
      },
      orderBy: [{ academicYear: { year: "desc" } }, { order: "asc" }],
    });

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      academicYearId: p.academicYearId,
      year: p.academicYear.year,
      isCurrent: p.isCurrent,
      yearIsCurrent: p.academicYear.isCurrent,
    }));
  }
}
