"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUpdateInstitutionTheme } from "@/modules/theme/infrastructure/container";
import { THEME_PRESETS, type InstitutionalTheme } from "@/modules/theme/domain/theme";

export interface ThemeFormState {
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
