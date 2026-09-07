"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeChangeCoverTemplateKey,
  makeResetCoverTemplate,
  makeSaveCoverTemplate,
  makeUpdateBundleCoverContent,
} from "@/modules/bundle-cover/infrastructure/container";
import { type CoverContent } from "@/modules/bundle-cover/domain/cover-content";
import { makeUpdateBundleTheme } from "@/modules/bundles/infrastructure/container";
import { type BundleTheme } from "@/modules/bundles/domain/bundle";

export interface CoverDesignerFormState {
  error?: string;
  success?: boolean;
}

export interface BundleThemeFormState {
  error?: string;
  success?: boolean;
}

export interface BundleCoverContentFormState {
  error?: string;
  success?: boolean;
}

/**
 * Guarda el HTML del editor como override de la plantilla de portada del
 * bundle (`EvaluationBundle.coverTemplateBody`).
 *
 * El use case ya valida:
 *   • tamaño en bytes (200 ≤ b ≤ 200_000),
 *   • ausencia de tags peligrosos (`<script>`, `<iframe>`, `<object>`,
 *     `<embed>`, `<form>`, `javascript:`).
 *
 * Aquí solo mapeamos `formData.body` → use case y revalidamos las rutas
 * que muestran el estado del cover.
 */
export async function saveCoverTemplateAction(
  bundleId: string,
  _prev: CoverDesignerFormState,
  formData: FormData,
): Promise<CoverDesignerFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const body = String(formData.get("body") ?? "");

  const result = await makeSaveCoverTemplate().execute({ actor, bundleId, body });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Guarda el override del tema por cuadernillo desde la sección "Tema" del
 * cover-designer. Duplica la lógica de /designer/actions.ts pero revalida
 * también `/cover-designer` para que la página refleje los valores nuevos
 * tras el Guardar.
 *
 * Solo editable en DRAFT (regla aplicada por UpdateBundleTheme). Si el
 * campo viene vacío se omite del Partial<BundleTheme> para caer al
 * institucional. NO incluye los campos del editor TipTap ni el checkbox
 * "Mostrar logo" — esos viven solo en /designer/.
 */
export async function saveBundleThemeAction(
  bundleId: string,
  _prev: BundleThemeFormState,
  formData: FormData,
): Promise<BundleThemeFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const theme: Partial<BundleTheme> = {
    primary: String(formData.get("primary") ?? "").trim() || undefined,
    fontFamily: formData.get("fontFamily") === "sans" ? "sans" : "serif",
    density: ["compact", "normal", "airy"].includes(String(formData.get("density") ?? ""))
      ? (String(formData.get("density")) as "compact" | "normal" | "airy")
      : undefined,
    questionColumns: String(formData.get("questionColumns") ?? "") === "2" ? 2 : 1,
    // Tamaño de fuente de los items (sep 2026). "" = heredar del tema
    // institucional (cae al default 10pt). Solo se acepta el set canónico
    // para no escribir valores fuera de `QUESTION_FONT_SIZES`.
    questionFontSize: [9, 10, 11, 12, 14, 16].includes(Number(formData.get("questionFontSize")))
      ? (Number(formData.get("questionFontSize")) as 9 | 10 | 11 | 12 | 14 | 16)
      : undefined,
    footerText: String(formData.get("footerText") ?? "").trim() || undefined,
    coverSubtitle: String(formData.get("coverSubtitle") ?? "").trim() || undefined,
    sectionDivider: ["line", "double", "dots"].includes(
      String(formData.get("sectionDivider") ?? ""),
    )
      ? (String(formData.get("sectionDivider")) as "line" | "double" | "dots")
      : undefined,
  };

  const result = await makeUpdateBundleTheme().execute({
    actor,
    bundleId,
    theme,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Limpia el override de portada y vuelve al built-in de la variante actual.
 * NO cambia la key del bundle.
 */
export async function resetCoverTemplateAction(bundleId: string): Promise<CoverDesignerFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const result = await makeResetCoverTemplate().execute({ actor, bundleId });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Cambia la variante de plantilla del bundle. Si la key es string vacío,
 * vuelve a DEFAULT_COVER_TEMPLATE_KEY (pass null al use case).
 *
 * Política del use case: cambiar la key NO borra el body override existente.
 * Si el docente quiere "cambiar y empezar limpio", debe pulsar también
 * "Restablecer" después de este action.
 */
export async function changeCoverTemplateKeyAction(
  bundleId: string,
  _prev: CoverDesignerFormState,
  formData: FormData,
): Promise<CoverDesignerFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const raw = String(formData.get("key") ?? "").trim();
  const key = raw === "" ? null : raw;

  const result = await makeChangeCoverTemplateKey().execute({ actor, bundleId, key });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Parsea los bullets de un FormData (que llegan como `field[]=a&field[]=b`).
 * Filtra strings vacíos (un bullet "vacío" no es override, es ausencia de
 * override — debe caer al default en runtime). Trunca al `max` del schema.
 */
function readBulletArray(formData: FormData, field: string, max: number): string[] {
  const raw = formData
    .getAll(field)
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  return raw.slice(0, max);
}

/**
 * Guarda el override del copy de portada por compendio desde la sección
 * "Contenido" del cover-designer (PR 3, ago 2026).
 *
 * Espejo de `saveBundleThemeAction`:
 * - Solo ECU_MASTER / ECU_LIDER (verificado por el use case).
 * - Solo en DRAFT (verificado por el use case via `isLocked`).
 * - Strings vacíos se omiten del Partial<CoverContent> para caer al
 *   institucional en runtime.
 * - `itemsBefore` y `itemsAfter` llegan como múltiples inputs con el mismo
 *   nombre (HTML estándar: `<input name="itemsBefore[]">`).
 *
 * Si TODOS los campos del form vienen vacíos, se graba un objeto `{}` al
 * JSONB (no `null`) — eso le dice al merge "este compendio NO override
 * nada, usa el institucional para todo". Si el admin quiere "reset al
 * DEFAULT_* sin pasar por el institucional", debe usar `resetBundleCoverContentAction`.
 */
export async function saveBundleCoverContentAction(
  bundleId: string,
  _prev: BundleCoverContentFormState,
  formData: FormData,
): Promise<BundleCoverContentFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const coverContent: Partial<CoverContent> = {
    legalFooter: String(formData.get("legalFooter") ?? "").trim() || undefined,
    instructionsTitle: String(formData.get("instructionsTitle") ?? "").trim() || undefined,
    calloutText: String(formData.get("calloutText") ?? "").trim() || undefined,
    howToMarkQuestion: String(formData.get("howToMarkQuestion") ?? "").trim() || undefined,
    howToMarkExample: String(formData.get("howToMarkExample") ?? "").trim() || undefined,
    howToMarkExampleLabel: String(formData.get("howToMarkExampleLabel") ?? "").trim() || undefined,
    prohibitedTitle: String(formData.get("prohibitedTitle") ?? "").trim() || undefined,
    prohibitedBody: String(formData.get("prohibitedBody") ?? "").trim() || undefined,
  };

  const itemsBefore = readBulletArray(formData, "itemsBefore", 10);
  if (itemsBefore.length > 0) coverContent.itemsBefore = itemsBefore;
  const itemsAfter = readBulletArray(formData, "itemsAfter", 15);
  if (itemsAfter.length > 0) coverContent.itemsAfter = itemsAfter;

  const result = await makeUpdateBundleCoverContent().execute({
    actor,
    bundleId,
    coverContent,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Limpia el override de contenido de portada del compendio y vuelve al
 * institucional. Pasa `null` al use case para que `UpdateBundleCoverContent`
 * escriba `coverContent = null` en la fila.
 */
export async function resetBundleCoverContentAction(
  bundleId: string,
): Promise<BundleCoverContentFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const result = await makeUpdateBundleCoverContent().execute({
    actor,
    bundleId,
    coverContent: null,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}
