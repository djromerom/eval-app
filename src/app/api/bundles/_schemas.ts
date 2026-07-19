import { z } from "zod";

/**
 * Schemas de validación (zod) para el body de las rutas /api/bundles/*.
 * La capa de aplicación (use cases) re-valida reglas de negocio; estos schemas
 * solo garantizan que el payload sea estructuralmente correcto.
 */

const objectId = z.string().min(1, "ID requerido");

export const createBundleSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio."),
  bookletNumber: z.number().int().positive().nullable().optional(),
  evaluationIds: z.array(objectId).min(1, "Selecciona al menos una evaluación."),
  theme: z.unknown().nullable().optional(),
});

export const updateBundleSchema = z.object({
  name: z.string().min(1).optional(),
  bookletNumber: z.number().int().positive().nullable().optional(),
  theme: z.unknown().nullable().optional(),
});

export const addItemSchema = z.object({
  evaluationId: objectId,
  order: z.number().int().positive().optional(),
});

export const reorderItemsSchema = z.object({
  itemIds: z.array(objectId).min(1, "La lista de items no puede estar vacía."),
});

export const updateThemeSchema = z.object({
  theme: z.unknown().nullable(),
});
