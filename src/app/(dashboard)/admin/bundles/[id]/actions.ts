"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeAddEvaluationToBundle,
  makeRemoveFromBundle,
  makeReorderBundleItems,
} from "@/modules/bundles/infrastructure/container";
import { PrismaBundleRepository } from "@/modules/bundles/infrastructure/prisma-bundle-repository";

export interface ItemsFormState {
  error?: string;
  success?: boolean;
}

// Repositorio compartido por las acciones de esta página (solo lectura de
// items + reorder transaccional). Misma instancia singleton: el coste de
// instanciar PrismaBundleRepository es trivial (no abre conexiones nuevas).
const repo = new PrismaBundleRepository();

/** Añade una evaluation al compendio (POST desde el form de la página detalle). */
export async function addItemAction(
  _prev: ItemsFormState,
  formData: FormData,
): Promise<ItemsFormState> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");
  const bundleId = String(formData.get("bundleId") ?? "");
  const evaluationId = String(formData.get("evaluationId") ?? "");
  if (!bundleId || !evaluationId) return { error: "Faltan datos." };

  const result = await makeAddEvaluationToBundle().execute({
    actor,
    bundleId,
    data: { evaluationId },
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  return { success: true };
}

/** Quita un item por id. */
export async function removeItemAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");
  const bundleId = String(formData.get("bundleId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!bundleId || !itemId) throw new Error("Faltan datos.");

  const result = await makeRemoveFromBundle().execute({ actor, bundleId, itemId });
  if (!result.ok) throw new Error(result.error.message);

  revalidatePath(`/admin/bundles/${bundleId}`);
}

/**
 * Mueve un item una posición arriba o abajo. Carga el orden actual,
 * calcula el nuevo orden (swap con el adyacente) y delega al use case
 * ReorderBundleItems para enforce de permisos / DRAFT.
 */
export async function moveItemAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");
  const bundleId = String(formData.get("bundleId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const direction = Number(formData.get("direction") ?? "0");
  if (!bundleId || !itemId || ![1, -1].includes(direction)) {
    throw new Error("Datos inválidos.");
  }

  // Cargar items actuales (en el orden guardado en DB).
  const items = await repo.listItemsOrdered(bundleId);
  const orderedIds: string[] = items.map((i) => i.id);
  const idx = orderedIds.indexOf(itemId);
  if (idx === -1) throw new Error("Item no encontrado.");
  const targetIdx = direction === -1 ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= orderedIds.length) return; // ya está en el extremo

  // Swap adyacente.
  const a = orderedIds[idx]!;
  const b = orderedIds[targetIdx]!;
  orderedIds[idx] = b;
  orderedIds[targetIdx] = a;

  const result = await makeReorderBundleItems().execute({
    actor,
    bundleId,
    itemIds: orderedIds,
  });
  if (!result.ok) throw new Error(result.error.message);

  revalidatePath(`/admin/bundles/${bundleId}`);
}
