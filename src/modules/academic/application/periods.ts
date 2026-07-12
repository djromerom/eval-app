import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type AcademicYearRepository,
  type CreatePeriodData,
  type Period,
  type PeriodRepository,
  isValidDateRange,
} from "../domain/types";

export interface CreatePeriodInput {
  actor: AuthenticatedUser;
  data: CreatePeriodData;
}

/** Crea un periodo académico ligado a un año de la institución (ADMIN). §3.2. */
export class CreatePeriod implements UseCase<CreatePeriodInput, Period> {
  constructor(
    private readonly periods: PeriodRepository,
    private readonly years: AcademicYearRepository,
  ) {}

  async execute({ actor, data }: CreatePeriodInput): Promise<Result<Period>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!data.name.trim())
      return fail(new ValidationError("El nombre del periodo es obligatorio."));
    if (!Number.isInteger(data.order) || data.order < 1) {
      return fail(new ValidationError("El orden debe ser un entero positivo."));
    }
    if (!isValidDateRange(data.startDate, data.endDate)) {
      return fail(new ValidationError("La fecha de inicio debe ser anterior a la de fin."));
    }

    const year = await this.years.findById(actor.institutionId, data.academicYearId);
    if (!year) {
      return fail(new ValidationError("El año académico indicado no existe en tu institución."));
    }

    return ok(await this.periods.create(actor.institutionId, data));
  }
}

export interface ListPeriodsInput {
  actor: AuthenticatedUser;
  academicYearId?: string;
}

export class ListPeriods implements UseCase<ListPeriodsInput, Period[]> {
  constructor(private readonly periods: PeriodRepository) {}

  async execute({ actor, academicYearId }: ListPeriodsInput): Promise<Result<Period[]>> {
    const authorized = requireRole(actor, "ADMIN", "COORDINATOR", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.periods.findAll(actor.institutionId, academicYearId));
  }
}
