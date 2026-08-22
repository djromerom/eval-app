"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUpdateInstitutionCoverContent } from "@/modules/bundle-cover/infrastructure/container";
import { type CoverContent } from "@/modules/bundle-cover/domain/cover-content";
import { makeUpdateInstitutionTheme } from "@/modules/theme/infrastructure/container";
import { THEME_PRESETS, type InstitutionalTheme } from "@/modules/theme/domain/theme";

export interface ThemeFormState {
  error?: string;
  success?: boolean;
}

export interface InstitutionCoverContentFormState {
  error?: string;
  success?: boolean;
}

function readForm(formData: FormData): Partial<InstitutionalTheme> {
  return {
    primary: String(formData.get("primary") ?? "").trim() || undefined,
    fontFamily: formData.get("fontFamily") === "sans" ? "sans" : "serif",
    density: ["compact", "normal", "airy"].includes(String(formData.get("density") ?? ""))
      ? (String(formData.get("density")) as "compact" | "normal" | "airy")
      : "normal",
    footerText: String(formData.get("footerText") ?? "").trim() || undefined,
    showLogo: formData.get("showLogo") === "on",
  };
}

/** Guarda el tema completo desde el form. ADMIN/SUPER_ADMIN. */
export async function saveThemeAction(
  _prev: ThemeFormState,
  formData: FormData,
): Promise<ThemeFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "SUPER_ADMIN");
  const theme = readForm(formData);
  const result = await makeUpdateInstitutionTheme().execute({ actor, theme });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/theme");
  revalidatePath("/print", "layout"); // las páginas de impresión dependen del tema
  return { success: true };
}

/** Aplica un preset (clasico | moderno | compacto). */
export async function applyPresetAction(preset: string): Promise<ThemeFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "SUPER_ADMIN");
  const chosen = THEME_PRESETS[preset];
  if (!chosen) return { error: `Preset "${preset}" no existe.` };

  const result = await makeUpdateInstitutionTheme().execute({
    actor,
    theme: chosen.theme as Partial<InstitutionalTheme>,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/theme");
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Parsea los bullets de un FormData (que llegan como `field[]=a&field[]=b`).
 * Filtra strings vacíos (un bullet "vacío" no es override, es ausencia de
 * override — debe caer al default en runtime). Trunca al `max` del schema.
 */
function readBulletArray(formData: FormData, field: string, max: number): string[] {
  const raw = formData.getAll(field).map((v) => String(v).trim()).filter((v) => v.length > 0);
  return raw.slice(0, max);
}

/**
 * Guarda el override institucional del copy de portada desde /admin/theme
 * (PR 3, ago 2026). Aplica a TODOS los compendios de la institución que
 * no tengan un override propio por-compendio.
 *
 * Espejo de `saveThemeAction`:
 * - Solo ECU_MASTER / SUPER_ADMIN (verificado por el use case).
 * - Strings vacíos se omiten del Partial<CoverContent> para caer al
 *   DEFAULT_* en runtime.
 *
 * Si TODOS los campos del form vienen vacíos, se graba un objeto `{}` al
 * JSONB (no `null`) — eso le dice al merge "esta institución NO override
 * nada, todos los compendios caen a DEFAULT_*". Si el admin quiere limpiar
 * el JSONB explícitamente (dejarlo en `null`), debe usar
 * `resetInstitutionCoverContentAction`.
 */
export async function saveInstitutionCoverContentAction(
  _prev: InstitutionCoverContentFormState,
  formData: FormData,
): Promise<InstitutionCoverContentFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "SUPER_ADMIN");

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

  const result = await makeUpdateInstitutionCoverContent().execute({
    actor,
    coverContent,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/theme");
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Limpia el override institucional del copy de portada y vuelve al DEFAULT_*.
 * Pasa `null` al use case para que `UpdateInstitutionCoverContent` escriba
 * `coverContent = null` en la fila.
 */
export async function resetInstitutionCoverContentAction(): Promise<InstitutionCoverContentFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "SUPER_ADMIN");
  const result = await makeUpdateInstitutionCoverContent().execute({
    actor,
    coverContent: null,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath("/admin/theme");
  revalidatePath("/print", "layout");
  return { success: true };
}
