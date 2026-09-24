import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type CreateSubjectData,
  SHORT_NAME_MAX,
  type Subject,
  type SubjectRepository,
  isValidCode,
  normalizeShortName,
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
    const shortName = normalizeShortName(data.shortName);
    if (shortName === undefined) {
      return fail(new ValidationError(`La sigla admite hasta ${SHORT_NAME_MAX} caracteres.`));
    }
    const clean = { ...data, shortName };

    if (data.global) {
      const authorized = requireRole(actor, "SUPER_ADMIN");
      if (!authorized.ok) return authorized;
      return ok(await this.subjects.create(null, clean));
    }

    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;
    return ok(await this.subjects.create(actor.institutionId, clean));
  }
}

export interface UpdateSubjectShortNameInput {
  actor: AuthenticatedUser;
  subjectId: string;
  /** Vacío = quitar la sigla (los informes vuelven a mostrar el nombre). */
  shortName: string;
}

/**
 * Cambia la sigla de una asignatura (encabezados de informes, p. ej. el
 * Informe detallado por grupo). Mismas reglas que la creación:
 *   - Asignatura de la institución → la edita un ECU_MASTER de esa institución.
 *   - Asignatura del catálogo global → solo un SUPER_ADMIN, porque la sigla
 *     es una sola y se ve en todas las instituciones que la usan.
 * Una asignatura de otra institución responde NOT_FOUND (no revela que existe).
 */
export class UpdateSubjectShortName implements UseCase<UpdateSubjectShortNameInput, Subject> {
  constructor(private readonly subjects: SubjectRepository) {}

  async execute({
    actor,
    subjectId,
    shortName,
  }: UpdateSubjectShortNameInput): Promise<Result<Subject>> {
    const subject = await this.subjects.findById(subjectId);
    if (
      !subject ||
      (subject.institutionId !== null && subject.institutionId !== actor.institutionId)
    ) {
      return fail(new NotFoundError("Asignatura", subjectId));
    }

    const authorized =
      subject.institutionId === null
        ? requireRole(actor, "SUPER_ADMIN")
        : requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const clean = normalizeShortName(shortName);
    if (clean === undefined) {
      return fail(new ValidationError(`La sigla admite hasta ${SHORT_NAME_MAX} caracteres.`));
    }
    return ok(await this.subjects.updateShortName(subjectId, clean));
  }
}

export interface ListSubjectsInput {
  actor: AuthenticatedUser;
}

/** Lista el catálogo visible: asignaturas de la institución + las globales. */
export class ListSubjects implements UseCase<ListSubjectsInput, Subject[]> {
  constructor(private readonly subjects: SubjectRepository) {}

  async execute({ actor }: ListSubjectsInput): Promise<Result<Subject[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.subjects.findAllForInstitution(actor.institutionId));
  }
}
