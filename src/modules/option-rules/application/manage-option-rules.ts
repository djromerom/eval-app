/**
 * Casos de uso para `OptionRule` (reglas de opciones de respuesta por
 * Prueba × Asignatura).
 *
 * Patrón idéntico a `src/modules/evaluation-rules/application/manage-evaluation-rules.ts`:
 * - UseCase<Input, Output> con `execute({ actor, ... })`.
 * - `requireRole` para gating (mutaciones → solo ECU_MASTER).
 * - `Result<T>` para errores legibles (nunca throw).
 * - `ValidationError`, `ConflictError`, `NotFoundError` desde shared.
 *
 * Particularidades:
 * - El rango (min, max) se valida en el dominio: enteros 2..8 y min ≤ max.
 * - La unicidad de la tupla (Prueba × Asignatura) la enforce Postgres
 *   (índice unique). Aquí hacemos un pre-check para el mensaje claro y, además,
 *   capturamos P2002 por si dos requests concurrentes pasan el pre-check.
 */

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
import type { PeriodRepository, SubjectRepository } from "@/modules/academic/domain/types";

import {
  type OptionRule,
  type OptionRuleRepository,
  isValidOptionsRange,
} from "../domain/option-rule";

/** P2002 = unique constraint violated. Detectamos aquí para no filtrar
 *  `@prisma/client` a la capa de aplicación. */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// CreateOptionRule
// ---------------------------------------------------------------------------

export interface CreateOptionRuleInput {
  actor: AuthenticatedUser;
  data: {
    periodId: string;
    subjectId: string;
    minOptions: number;
    maxOptions: number;
  };
}

export class CreateOptionRule implements UseCase<CreateOptionRuleInput, OptionRule> {
  constructor(
    private readonly rules: OptionRuleRepository,
    private readonly periods: PeriodRepository,
    private readonly subjects: SubjectRepository,
  ) {}

  async execute({ actor, data }: CreateOptionRuleInput): Promise<Result<OptionRule>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!isValidOptionsRange(data.minOptions, data.maxOptions)) {
      return fail(
        new ValidationError(
          "El mínimo y el máximo deben ser números enteros entre 2 y 8, y el mínimo no puede ser mayor que el máximo.",
        ),
      );
    }

    // Validar FKs en orden. Mensajes claros para el docente.
    const period = await this.periods.findById(actor.institutionId, data.periodId);
    if (!period) return fail(new NotFoundError("Prueba", data.periodId));

    const subject = await this.subjects.findById(data.subjectId);
    if (!subject) return fail(new NotFoundError("Asignatura", data.subjectId));

    // Pre-check de unicidad de la tupla (mensaje más claro que dejar
    // que Postgres lo rechace).
    const siblings = await this.rules.listByPeriod(actor.institutionId, data.periodId);
    const duplicate = siblings.find((r) => r.subjectId === data.subjectId);
    if (duplicate) {
      return fail(
        new ConflictError("Ya existe una regla de opciones para esta asignatura en la prueba."),
      );
    }

    try {
      const created = await this.rules.create(actor.institutionId, {
        periodId: data.periodId,
        subjectId: data.subjectId,
        minOptions: data.minOptions,
        maxOptions: data.maxOptions,
        createdById: actor.userId,
      });
      return ok(created);
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        return fail(
          new ConflictError("Ya existe una regla de opciones para esta asignatura en la prueba."),
        );
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// ListOptionRulesByPeriod
// ---------------------------------------------------------------------------

export interface ListOptionRulesByPeriodInput {
  actor: AuthenticatedUser;
  periodId: string;
}

export class ListOptionRulesByPeriod implements UseCase<
  ListOptionRulesByPeriodInput,
  OptionRule[]
> {
  constructor(private readonly rules: OptionRuleRepository) {}

  async execute({ actor, periodId }: ListOptionRulesByPeriodInput): Promise<Result<OptionRule[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const list = await this.rules.listByPeriod(actor.institutionId, periodId);
    return ok(list);
  }
}

// ---------------------------------------------------------------------------
// ListOptionRulesByInstitution
// ---------------------------------------------------------------------------

export interface ListOptionRulesByInstitutionInput {
  actor: AuthenticatedUser;
}

export class ListOptionRulesByInstitution implements UseCase<
  ListOptionRulesByInstitutionInput,
  OptionRule[]
> {
  constructor(private readonly rules: OptionRuleRepository) {}

  async execute({ actor }: ListOptionRulesByInstitutionInput): Promise<Result<OptionRule[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const list = await this.rules.listByInstitution(actor.institutionId);
    return ok(list);
  }
}

// ---------------------------------------------------------------------------
// UpdateOptionRule
// ---------------------------------------------------------------------------

export interface UpdateOptionRuleInput {
  actor: AuthenticatedUser;
  id: string;
  data: {
    minOptions?: number;
    maxOptions?: number;
  };
}

export class UpdateOptionRule implements UseCase<UpdateOptionRuleInput, OptionRule> {
  constructor(private readonly rules: OptionRuleRepository) {}

  async execute({ actor, id, data }: UpdateOptionRuleInput): Promise<Result<OptionRule>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const existing = await this.rules.findById(actor.institutionId, id);
    if (!existing) return fail(new NotFoundError("Regla de opciones", id));

    const min = data.minOptions ?? existing.minOptions;
    const max = data.maxOptions ?? existing.maxOptions;
    if (!isValidOptionsRange(min, max)) {
      return fail(
        new ValidationError(
          "El mínimo y el máximo deben ser números enteros entre 2 y 8, y el mínimo no puede ser mayor que el máximo.",
        ),
      );
    }

    const updated = await this.rules.update(actor.institutionId, id, data);
    if (!updated) return fail(new NotFoundError("Regla de opciones", id));
    return ok(updated);
  }
}

// ---------------------------------------------------------------------------
// DeleteOptionRule
// ---------------------------------------------------------------------------

export interface DeleteOptionRuleInput {
  actor: AuthenticatedUser;
  id: string;
}

export class DeleteOptionRule implements UseCase<DeleteOptionRuleInput, void> {
  constructor(private readonly rules: OptionRuleRepository) {}

  async execute({ actor, id }: DeleteOptionRuleInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const existing = await this.rules.findById(actor.institutionId, id);
    if (!existing) return fail(new NotFoundError("Regla de opciones", id));

    await this.rules.delete(actor.institutionId, id);
    return ok(undefined);
  }
}
