import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import {
  ConflictError,
  NotFoundError,
  type Result,
  ValidationError,
  fail,
  ok,
} from "@/shared/domain/result";
import {
  type AcademicYearRepository,
  type CreatePeriodData,
  type Period,
  type PeriodRepository,
  type UpdatePeriodData,
  isValidDateRange,
} from "../domain/types";

export interface CreatePeriodInput {
  actor: AuthenticatedUser;
  data: CreatePeriodData;
}

/**
 * Traduce un PrismaClientKnownRequestError con `code === 'P2002'` a un
 * ConflictError legible para el docente. La capa de aplicación no puede
 * importar `@prisma/client` (regla de capas), así que nos guiamos por el
 * código `P2002` como string en la propiedad `code` del error. Es estable
 * y parte del contrato público de Prisma.
 */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

/** Crea un periodo académico ligado a un año de la institución (ADMIN). §3.2. */
export class CreatePeriod implements UseCase<CreatePeriodInput, Period> {
  constructor(
    private readonly periods: PeriodRepository,
    private readonly years: AcademicYearRepository,
  ) {}

  async execute({ actor, data }: CreatePeriodInput): Promise<Result<Period>> {
    const authorized = requireRole(actor, "ECU_MASTER");
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

    // Pre-check del unique (institutionId, academicYearId, name) para
    // devolver un mensaje claro sin que Prisma aborte la request con P2002.
    const existing = await this.periods.findAll(actor.institutionId, data.academicYearId);
    if (existing.some((p) => p.name.trim() === data.name.trim())) {
      return fail(
        new ConflictError(`Ya existe un periodo llamado "${data.name}" en este año académico.`),
      );
    }

    // Red de seguridad: si por una carrera entre requests el pre-check no
    // detectó el duplicado, traducimos el P2002 al mismo ConflictError en
    // lugar de dejar que el error de Prisma burbujee hasta el overlay de
    // Next.js.
    try {
      return ok(await this.periods.create(actor.institutionId, data));
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        return fail(
          new ConflictError(`Ya existe un periodo llamado "${data.name}" en este año académico.`),
        );
      }
      throw err;
    }
  }
}

export interface ListPeriodsInput {
  actor: AuthenticatedUser;
  academicYearId?: string;
}
export class ListPeriods implements UseCase<ListPeriodsInput, Period[]> {
  constructor(private readonly periods: PeriodRepository) {}

  async execute({ actor, academicYearId }: ListPeriodsInput): Promise<Result<Period[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "COORDINATOR", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.periods.findAll(actor.institutionId, academicYearId));
  }
}

/** Carga un periodo por id; usado por el drawer de edición (Fase 11). */
export interface GetPeriodInput {
  actor: AuthenticatedUser;
  periodId: string;
}
export class GetPeriod implements UseCase<GetPeriodInput, Period> {
  constructor(private readonly periods: PeriodRepository) {}

  async execute({ actor, periodId }: GetPeriodInput): Promise<Result<Period>> {
    const authorized = requireRole(actor, "ECU_MASTER", "COORDINATOR", "TEACHER");
    if (!authorized.ok) return authorized;
    const period = await this.periods.findById(actor.institutionId, periodId);
    if (!period) return fail(new NotFoundError("Periodo", periodId));
    return ok(period);
  }
}

// ===== Update (Fase 11 — drawer de edición) =====

export interface UpdatePeriodInput {
  actor: AuthenticatedUser;
  periodId: string;
  data: UpdatePeriodData;
}

/**
 * Edita un periodo académico. Solo `ECU_MASTER`. Mismas validaciones de
 * shape que `CreatePeriod` (orden entero positivo, fechas coherentes).
 *
 * Pre-check de unicidad en (institutionId, academicYearId, name) con try/catch
 * sobre P2002 para que el error salga como ConflictError legible (mismo
 * patrón que CreatePeriod).
 *
 * El `academicYearId` no se puede cambiar desde aquí — está implícito en el
 * periodo actual. Quien quiera moverlo a otro año debe borrarlo y crearlo
 * de nuevo en el año destino (la UI lo refleja en el hint del drawer).
 */
export class UpdatePeriod implements UseCase<UpdatePeriodInput, Period> {
  constructor(
    private readonly periods: PeriodRepository,
    private readonly years: AcademicYearRepository,
  ) {}

  async execute({ actor, periodId, data }: UpdatePeriodInput): Promise<Result<Period>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const current = await this.periods.findById(actor.institutionId, periodId);
    if (!current) return fail(new NotFoundError("Periodo", periodId));

    if (data.name !== undefined && !data.name.trim()) {
      return fail(new ValidationError("El nombre del periodo es obligatorio."));
    }
    if (data.order !== undefined && (!Number.isInteger(data.order) || data.order < 1)) {
      return fail(new ValidationError("El orden debe ser un entero positivo."));
    }
    if (data.startDate !== undefined && data.endDate !== undefined) {
      if (!isValidDateRange(data.startDate, data.endDate)) {
        return fail(new ValidationError("La fecha de inicio debe ser anterior a la de fin."));
      }
    }

    // Si cambian las fechas pero no ambas, validar contra la actual.
    if (data.startDate !== undefined && data.endDate === undefined) {
      if (!isValidDateRange(data.startDate, current.endDate)) {
        return fail(new ValidationError("La fecha de inicio debe ser anterior a la de fin."));
      }
    }
    if (data.endDate !== undefined && data.startDate === undefined) {
      if (!isValidDateRange(current.startDate, data.endDate)) {
        return fail(new ValidationError("La fecha de inicio debe ser anterior a la de fin."));
      }
    }

    // Pre-check del unique constraint. Excluimos el periodo actual de la
    // búsqueda para no chocar contra sí mismo al "no cambiar nada".
    if (data.name !== undefined && data.name.trim() !== current.name) {
      const siblings = await this.periods.findAll(actor.institutionId, current.academicYearId);
      if (siblings.some((p) => p.id !== current.id && p.name.trim() === data.name!.trim())) {
        return fail(
          new ConflictError(`Ya existe un periodo llamado "${data.name}" en este año académico.`),
        );
      }
    }

    try {
      const updated = await this.periods.update(actor.institutionId, periodId, data);
      if (!updated) return fail(new NotFoundError("Periodo", periodId));
      return ok(updated);
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        return fail(
          new ConflictError(
            `Ya existe un periodo llamado "${data.name ?? current.name}" en este año académico.`,
          ),
        );
      }
      throw err;
    }
  }
}

// ===== Delete (Fase 11 — drawer de edición) =====

export interface DeletePeriodInput {
  actor: AuthenticatedUser;
  periodId: string;
}

/**
 * Elimina un periodo académico. Solo `ECU_MASTER`.
 *
 * No verificamos si hay formulaciones/usos apuntando al periodo: borrar un
 * periodo con formulaciones es destructivo y la UI ya pide confirmación.
 * Si en el futuro se quiere soft-delete o bloqueo por dependencias, este es
 * el punto a extender.
 */
export class DeletePeriod implements UseCase<DeletePeriodInput, void> {
  constructor(private readonly periods: PeriodRepository) {}

  async execute({ actor, periodId }: DeletePeriodInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const current = await this.periods.findById(actor.institutionId, periodId);
    if (!current) return fail(new NotFoundError("Periodo", periodId));

    await this.periods.delete(actor.institutionId, periodId);
    return ok(undefined);
  }
}
