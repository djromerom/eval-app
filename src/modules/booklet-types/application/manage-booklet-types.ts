/**
 * Casos de uso para BookletType (catálogo por Prueba).
 *
 * Patrón idéntico a `src/modules/academic/application/periods.ts`:
 * - UseCase<Input, Output> con `execute({ actor, ... })`.
 * - `requireRole` para gating.
 * - `Result<T>` para errores legibles (nunca throw).
 * - `ValidationError`, `ConflictError`, `NotFoundError` desde shared.
 *
 * Particularidades:
 * - Crear/Editar/Eliminar → solo `ECU_MASTER`.
 * - Listar → cualquiera con sesión.
 * - Validamos FK de `periodId` contra el repo de periodos para devolver
 *   un error legible si la Prueba no existe o pertenece a otra institución.
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
import type { PeriodRepository } from "@/modules/academic/domain/types";

import type {
  BookletType,
  BookletTypeRepository,
  CreateBookletTypeData,
  UpdateBookletTypeData,
} from "../domain/booklet-type";
import { isValidBookletTypeName } from "../domain/booklet-type";

// ---------------------------------------------------------------------------
// Error de Prisma
// ---------------------------------------------------------------------------

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
// CreateBookletType
// ---------------------------------------------------------------------------

export interface CreateBookletTypeInput {
  actor: AuthenticatedUser;
  periodId: string;
  data: {
    name: string;
    description?: string;
    order?: number;
  };
}

export class CreateBookletType implements UseCase<CreateBookletTypeInput, BookletType> {
  constructor(
    private readonly bookletTypes: BookletTypeRepository,
    private readonly periods: PeriodRepository,
  ) {}

  async execute({ actor, periodId, data }: CreateBookletTypeInput): Promise<Result<BookletType>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (!isValidBookletTypeName(data.name)) {
      return fail(new ValidationError("El nombre del tipo debe tener entre 1 y 50 caracteres."));
    }

    // Verificamos que la Prueba exista y sea de la misma institución
    // antes del pre-check de unicidad (mensaje más claro).
    const period = await this.periods.findById(actor.institutionId, periodId);
    if (!period) {
      return fail(new NotFoundError("Prueba", periodId));
    }

    // Pre-check de unicidad dentro de la Prueba. Si choca, devolvemos
    // 409 (no 500) sin esperar a Postgres.
    const existing = await this.bookletTypes.listByPeriod(actor.institutionId, periodId);
    if (existing.some((b) => b.name.trim() === data.name.trim())) {
      return fail(
        new ConflictError(
          `Ya existe un tipo de cuadernillo con el nombre "${data.name}" en esta prueba.`,
        ),
      );
    }

    const createData: CreateBookletTypeData = {
      periodId,
      name: data.name.trim(),
      description: data.description?.trim() || undefined,
      order: data.order,
    };

    try {
      const created = await this.bookletTypes.create(actor.institutionId, createData);
      return ok(created);
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        return fail(
          new ConflictError(
            `Ya existe un tipo de cuadernillo con el nombre "${data.name}" en esta prueba.`,
          ),
        );
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// ListBookletTypesByPeriod (form admin)
// ---------------------------------------------------------------------------

export interface ListBookletTypesByPeriodInput {
  actor: AuthenticatedUser;
  periodId: string;
}

export class ListBookletTypesByPeriod implements UseCase<
  ListBookletTypesByPeriodInput,
  BookletType[]
> {
  constructor(private readonly bookletTypes: BookletTypeRepository) {}

  async execute({
    actor,
    periodId,
  }: ListBookletTypesByPeriodInput): Promise<Result<BookletType[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const list = await this.bookletTypes.listByPeriod(actor.institutionId, periodId);
    return ok(list);
  }
}

// ---------------------------------------------------------------------------
// ListBookletTypesByInstitution (form Mis formulaciones)
// ---------------------------------------------------------------------------

export interface ListBookletTypesByInstitutionInput {
  actor: AuthenticatedUser;
}

export class ListBookletTypesByInstitution implements UseCase<
  ListBookletTypesByInstitutionInput,
  BookletType[]
> {
  constructor(private readonly bookletTypes: BookletTypeRepository) {}

  async execute({ actor }: ListBookletTypesByInstitutionInput): Promise<Result<BookletType[]>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER", "TEACHER");
    if (!authorized.ok) return authorized;

    const list = await this.bookletTypes.listByInstitution(actor.institutionId);
    return ok(list);
  }
}

// ---------------------------------------------------------------------------
// UpdateBookletType
// ---------------------------------------------------------------------------

export interface UpdateBookletTypeInput {
  actor: AuthenticatedUser;
  id: string;
  data: {
    name?: string;
    description?: string | null;
    order?: number;
  };
}

export class UpdateBookletType implements UseCase<UpdateBookletTypeInput, BookletType> {
  constructor(private readonly bookletTypes: BookletTypeRepository) {}

  async execute({ actor, id, data }: UpdateBookletTypeInput): Promise<Result<BookletType>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    if (data.name !== undefined && !isValidBookletTypeName(data.name)) {
      return fail(new ValidationError("El nombre del tipo debe tener entre 1 y 50 caracteres."));
    }

    const existing = await this.bookletTypes.findById(actor.institutionId, id);
    if (!existing) {
      return fail(new NotFoundError("Tipo de cuadernillo", id));
    }

    // Si cambia el name, validar unicidad.
    if (data.name !== undefined && data.name.trim() !== existing.name) {
      const siblings = await this.bookletTypes.listByPeriod(actor.institutionId, existing.periodId);
      if (siblings.some((b) => b.id !== id && b.name.trim() === data.name!.trim())) {
        return fail(
          new ConflictError(
            `Ya existe un tipo de cuadernillo con el nombre "${data.name}" en esta prueba.`,
          ),
        );
      }
    }

    const updateData: UpdateBookletTypeData = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined) {
      updateData.description = data.description === null ? null : data.description.trim() || null;
    }
    if (data.order !== undefined) updateData.order = data.order;

    try {
      const updated = await this.bookletTypes.update(actor.institutionId, id, updateData);
      if (!updated) {
        return fail(new NotFoundError("Tipo de cuadernillo", id));
      }
      return ok(updated);
    } catch (e) {
      if (isPrismaUniqueConstraintError(e)) {
        return fail(
          new ConflictError(
            `Ya existe un tipo de cuadernillo con el nombre "${data.name ?? existing.name}" en esta prueba.`,
          ),
        );
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// DeleteBookletType
// ---------------------------------------------------------------------------

export interface DeleteBookletTypeInput {
  actor: AuthenticatedUser;
  id: string;
}

export class DeleteBookletType implements UseCase<DeleteBookletTypeInput, void> {
  constructor(private readonly bookletTypes: BookletTypeRepository) {}

  async execute({ actor, id }: DeleteBookletTypeInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ECU_MASTER");
    if (!authorized.ok) return authorized;

    const existing = await this.bookletTypes.findById(actor.institutionId, id);
    if (!existing) {
      return fail(new NotFoundError("Tipo de cuadernillo", id));
    }

    // No validamos dependencias: la FK en `Evaluation.bookletTypeId` es
    // ON DELETE SET NULL. Si había evaluaciones usando este tipo, su
    // `bookletTypeId` quedará `null` (efecto documentado).
    await this.bookletTypes.delete(actor.institutionId, id);
    return ok(undefined);
  }
}
