import { z } from "zod";
import { EvaluationThemeSchema } from "@/modules/theme/domain/theme";

/**
 * Schemas de validación (zod) para el body de las rutas /api/bundles/*.
 * La capa de aplicación (use cases) re-valida reglas de negocio; estos schemas
 * solo garantizan que el payload sea estructuralmente correcto.
 *
 * El theme se valida con el mismo schema que usa el designer (parcial,
 * todos los campos opcionales). Lo que llegue en el body que no coincida
 * con `EvaluationThemeSchema` se rechaza en la frontera del endpoint —
 * antes solíamos usar `z.unknown()` que dejaba pasar cualquier JSON
 * corrupto a la BD.
 */

const objectId = z.string().min(1, "ID requerido");

export const createBundleSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio."),
  bookletNumber: z.number().int().positive().nullable().optional(),
  // Sprint 9: `null`/ausente = compendio cross-course. Si viene, el use case
  // valida que exista en la institución y que los items coincidan.
  courseId: objectId.nullable().optional(),
  evaluationIds: z.array(objectId).min(1, "Selecciona al menos una evaluación."),
  theme: EvaluationThemeSchema.partial().nullable().optional(),
});

export const updateBundleSchema = z.object({
  name: z.string().min(1).optional(),
  bookletNumber: z.number().int().positive().nullable().optional(),
  courseId: objectId.nullable().optional(),
  theme: EvaluationThemeSchema.partial().nullable().optional(),
});

export const addItemSchema = z.object({
  evaluationId: objectId,
  order: z.number().int().positive().optional(),
});

export const reorderItemsSchema = z.object({
  itemIds: z.array(objectId).min(1, "La lista de items no puede estar vacía."),
});

/**
 * Body de PATCH /api/bundles/[id]/theme — endpoint dedicado para el
 * designer. Misma forma que `EvaluationThemeSchema.partial()` pero al ser
 * explícitamente nullable, soporta `null` para "resetear al institucional".
 */
export const updateThemeSchema = z.object({
  theme: EvaluationThemeSchema.partial().nullable(),
});
