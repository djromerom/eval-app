import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type CreateSubjectData,
  type Subject,
  type SubjectRepository,
  isValidCode,
} from "../domain/types";

export interface CreateSubjectInput {
  actor: AuthenticatedUser;
  data: CreateSubjectData;
}

/**
 * Crea una asignatura. Por institución la crea un ADMIN; el catálogo global
 * (institutionId null) solo lo crea un SUPER_ADMIN. REQUERIMIENTOS_v2.md §3.2.
 */
export class CreateSubject implements UseCase<CreateSubjectInput, Subject> {
  constructor(private readonly subjects: SubjectRepository) {}

  async execute({ actor, data }: CreateSubjectInput): Promise<Result<Subject>> {
    if (!data.name.trim()) return fail(new ValidationError("El nombre es obligatorio."));
    if (!isValidCode(data.code)) return fail(new ValidationError("Código de asignatura inválido."));

    if (data.global) {
      const authorized = requireRole(actor, "SUPER_ADMIN");
      if (!authorized.ok) return authorized;
      return ok(await this.subjects.create(null, data));
    }

    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;
    return ok(await this.subjects.create(actor.institutionId, data));
  }
}

export interface ListSubjectsInput {
  actor: AuthenticatedUser;
}

/** Lista el catálogo visible: asignaturas de la institución + las globales. */
export class ListSubjects implements UseCase<ListSubjectsInput, Subject[]> {
  constructor(private readonly subjects: SubjectRepository) {}

  async execute({ actor }: ListSubjectsInput): Promise<Result<Subject[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "COORDINATOR", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.subjects.findAllForInstitution(actor.institutionId));
  }
}
