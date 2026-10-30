/**
 * Use case: lista los docentes formuladores por cuadernillo de la institución
 * del actor.
 *
 * Scoping: solo ECU_MASTER y SUPER_ADMIN — el mismo criterio que el listado
 * de formulaciones (`requireRole` en el use case + capability `run-queries`
 * en el UI).
 *
 * Devuelve `FormuladorRow[]`: una fila por relación "docente ↔ cuadernillo ↔
 * grado ↔ asignatura", más las formulaciones que quedaron sin docente
 * asignado. Ver `src/modules/consultas/domain/queries/formuladores/`.
 */
import { requireRole, type AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ok } from "@/shared/domain/result";
import type { FormuladorRow } from "../domain/queries/formuladores/formulador-row";

/** Puerto (interface) que el use case necesita. La impl vive en
 *  `infrastructure/`. Se inyecta desde el container para poder testear el
 *  use case con un in-memory. */
export interface FormuladoresReader {
  /** Devuelve las filas de la consulta para UNA institución. */
  listByInstitution(institutionId: string): Promise<FormuladorRow[]>;
}

export interface ListFormuladoresInput {
  actor: AuthenticatedUser;
}

export class ListFormuladores implements UseCase<ListFormuladoresInput, FormuladorRow[]> {
  constructor(private readonly reader: FormuladoresReader) {}

  async execute({ actor }: ListFormuladoresInput): Promise<Result<FormuladorRow[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "SUPER_ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.reader.listByInstitution(actor.institutionId));
  }
}
