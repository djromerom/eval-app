/**
 * Use case: lista las Pruebas (Periodos) de la institución del actor.
 *
 * Existe para el filtro "Prueba" de la consulta "Listado de Formulaciones":
 * las opciones del select NO se derivan de las filas (una prueba sin
 * formulaciones no aparecería y, peor, la prueba actual podría no estar
 * entre ellas), sino de la tabla de periodos de la institución.
 *
 * Scoping: mismo gate que `ListFormulaciones` (ECU_MASTER / SUPER_ADMIN /
 * ECU_LIDER) — son la misma consulta, solo que la lista de filtros. El líder
 * puede ver el catálogo de pruebas de la institución: son los nombres de las
 * pruebas, no datos de otros grados (el recorte de las filas lo hace
 * `ListFormulaciones`).
 *
 * Devuelve `PruebaOpcion[]`: el DTO con los dos flags de "actual" (la prueba
 * dentro de su año y el año académico de la institución) para que la UI
 * pueda resolver la prueba en curso sin conocer el módulo academic.
 */
import { requireRole, type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { PruebaOpcion } from "../domain/shared/prueba-opcion";

/** Puerto (interface) del que depende el use case. La impl vive en
 *  `infrastructure/` (ver `pruebas-fetcher.ts`). */
export interface PruebasReader {
  /** Pruebas de la institución, ordenadas por año académico descendente y,
   *  dentro del año, por `order` ascendente. */
  listByInstitution(institutionId: string): Promise<PruebaOpcion[]>;
}

export interface ListPruebasInput {
  actor: AuthenticatedUser;
}

export class ListPruebas implements UseCase<ListPruebasInput, PruebaOpcion[]> {
  constructor(private readonly reader: PruebasReader) {}

  async execute({ actor }: ListPruebasInput): Promise<Result<PruebaOpcion[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    return ok(await this.reader.listByInstitution(actor.institutionId));
  }
}
