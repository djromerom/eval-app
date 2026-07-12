import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type AcademicYear,
  type AcademicYearRepository,
  type CreateAcademicYearData,
  isValidDateRange,
} from "../domain/types";

export interface CreateAcademicYearInput {
  actor: AuthenticatedUser;
  data: CreateAcademicYearData;
}

/** Crea un año académico (ADMIN). REQUERIMIENTOS_v2.md §3.2. */
export class CreateAcademicYear implements UseCase<CreateAcademicYearInput, AcademicYear> {
  constructor(private readonly years: AcademicYearRepository) {}

  async execute({ actor, data }: CreateAcademicYearInput): Promise<Result<AcademicYear>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!Number.isInteger(data.year) || data.year < 2000 || data.year > 2100) {
      return fail(new ValidationError("El año debe ser un entero entre 2000 y 2100."));
    }
    if (!isValidDateRange(data.startDate, data.endDate)) {
      return fail(new ValidationError("La fecha de inicio debe ser anterior a la de fin."));
    }
    if (await this.years.findByYear(actor.institutionId, data.year)) {
      return fail(new ValidationError(`Ya existe el año académico ${data.year}.`));
    }

    const created = await this.years.create(actor.institutionId, data);
    if (data.isCurrent) await this.years.setCurrent(actor.institutionId, created.id);
    return ok({ ...created, isCurrent: data.isCurrent ?? created.isCurrent });
  }
}

export interface ListAcademicYearsInput {
  actor: AuthenticatedUser;
}

export class ListAcademicYears implements UseCase<ListAcademicYearsInput, AcademicYear[]> {
  constructor(private readonly years: AcademicYearRepository) {}

  async execute({ actor }: ListAcademicYearsInput): Promise<Result<AcademicYear[]>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.years.findAll(actor.institutionId));
  }
}
