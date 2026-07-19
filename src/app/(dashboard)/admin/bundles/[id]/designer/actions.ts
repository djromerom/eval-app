"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeUpdateBundleTheme } from "@/modules/bundles/infrastructure/container";
import { type BundleTheme } from "@/modules/bundles/domain/bundle";

export interface BundleDesignerFormState {
  error?: string;
  success?: boolean;
}

/**
 * Guarda el tema del compendio (override por compendio sobre el institucional).
 *
 * - Solo SUPER_ADMIN: el compendio es multi-evaluación y solo el
 *   administrador institucional puede personalizarlo.
 * - Solo en DRAFT (verificado por el use case UpdateBundleTheme, que
 *   retorna `ValidationError` si el compendio ya está READY).
 *
 * Si un campo viene vacío se omite del `Partial<BundleTheme>` (cae al
 * institucional). El `null` global se usa para "reset al institucional"
 * desde el botón Restablecer.
 */
export async function saveBundleThemeAction(
  bundleId: string,
  _prev: BundleDesignerFormState,
  formData: FormData,
): Promise<BundleDesignerFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const theme: Partial<BundleTheme> = {
    primary: String(formData.get("primary") ?? "").trim() || undefined,
    fontFamily: formData.get("fontFamily") === "sans" ? "sans" : "serif",
    density: ["compact", "normal", "airy"].includes(String(formData.get("density") ?? ""))
      ? (String(formData.get("density")) as "compact" | "normal" | "airy")
      : undefined,
    footerText: String(formData.get("footerText") ?? "").trim() || undefined,
    showLogo: formData.get("showLogo") === "on",
    coverSubtitle: String(formData.get("coverSubtitle") ?? "").trim() || undefined,
    sectionDivider: ["line", "double", "dots"].includes(
      String(formData.get("sectionDivider") ?? ""),
    )
      ? (String(formData.get("sectionDivider")) as "line" | "double" | "dots")
      : undefined,
  };

  // introText es JSON serializado de TipTap. Si viene vacío lo descartamos;
  // si viene JSON inválido lo registramos como error de validación en lugar
  // de tirar la request (un admin pegando texto crudo no debe tirar todo).
  const introRaw = String(formData.get("introText") ?? "").trim();
  if (introRaw) {
    try {
      const parsed = JSON.parse(introRaw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        theme.introText = parsed as Record<string, unknown>;
      } else {
        return { error: "Bloque intro: el contenido no es un documento TipTap válido." };
      }
    } catch {
      return { error: "Bloque intro: JSON inválido. ¿Se modificó el editor manualmente?" };
    }
  }

  const result = await makeUpdateBundleTheme().execute({
    actor,
    bundleId,
    theme,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}

/**
 * Limpia el override y vuelve al tema institucional.
 * Pasa `null` al use case para que UpdateBundleTheme escriba
 * `theme = null` en la fila.
 */
export async function resetBundleThemeAction(bundleId: string): Promise<BundleDesignerFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeUpdateBundleTheme().execute({
    actor,
    bundleId,
    theme: null,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/designer`);
  revalidatePath("/print", "layout");
  return { success: true };
}
