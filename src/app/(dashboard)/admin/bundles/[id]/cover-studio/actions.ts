"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeSaveCoverStudio } from "@/modules/bundle-cover/infrastructure/container";
import type { CoverContent } from "@/modules/bundle-cover/domain/cover-content";
import type { BundleTheme } from "@/modules/bundles/domain/bundle";
import {
  STUDIO_BLOCK_IDS,
  type StudioBlockState,
} from "@/modules/bundle-cover/domain/block-sections";

export interface CoverStudioFormState {
  error?: string;
  success?: boolean;
}

/**
 * Parsea los bullets de un FormData (mismo helper que cover-designer/actions.ts).
 * Filtra strings vacíos y trunca al `max` del schema.
 */
function readBulletArray(formData: FormData, field: string, max: number): string[] {
  const raw = formData
    .getAll(field)
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  return raw.slice(0, max);
}

/**
 * Server action del Cover Studio: aplica tema + contenido + toggles de bloques
 * en una sola pasada. El HTML final se persiste como override en
 * `EvaluationBundle.coverTemplateBody` solo si cambia (si no, no escribimos).
 *
 * Mapeo FormData → use case:
 *   • theme:        campos con prefijo `theme.` (primary, fontFamily, density, …).
 *   • coverContent: campos con prefijo `content.` (instructionsTitle, calloutText, …)
 *     + arrays `content.itemsBefore[]` y `content.itemsAfter[]`.
 *   • blockState:   checkboxes `block.<id>` (true si presente, false si no).
 */
export async function saveCoverStudioAction(
  bundleId: string,
  _prev: CoverStudioFormState,
  formData: FormData,
): Promise<CoverStudioFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const theme: Partial<BundleTheme> = {
    primary: String(formData.get("theme.primary") ?? "").trim() || undefined,
    fontFamily: formData.get("theme.fontFamily") === "sans" ? "sans" : "serif",
    density: ["compact", "normal", "airy"].includes(String(formData.get("theme.density") ?? ""))
      ? (String(formData.get("theme.density")) as "compact" | "normal" | "airy")
      : undefined,
    questionColumns: String(formData.get("theme.questionColumns") ?? "") === "2" ? 2 : 1,
    footerText: String(formData.get("theme.footerText") ?? "").trim() || undefined,
    coverSubtitle: String(formData.get("theme.coverSubtitle") ?? "").trim() || undefined,
    sectionDivider: ["line", "double", "dots"].includes(
      String(formData.get("theme.sectionDivider") ?? ""),
    )
      ? (String(formData.get("theme.sectionDivider")) as "line" | "double" | "dots")
      : undefined,
  };

  const coverContent: Partial<CoverContent> = {
    legalFooter: String(formData.get("content.legalFooter") ?? "").trim() || undefined,
    instructionsTitle: String(formData.get("content.instructionsTitle") ?? "").trim() || undefined,
    calloutText: String(formData.get("content.calloutText") ?? "").trim() || undefined,
    howToMarkQuestion: String(formData.get("content.howToMarkQuestion") ?? "").trim() || undefined,
    howToMarkExample: String(formData.get("content.howToMarkExample") ?? "").trim() || undefined,
    howToMarkExampleLabel:
      String(formData.get("content.howToMarkExampleLabel") ?? "").trim() || undefined,
    prohibitedTitle: String(formData.get("content.prohibitedTitle") ?? "").trim() || undefined,
    prohibitedBody: String(formData.get("content.prohibitedBody") ?? "").trim() || undefined,
  };

  const itemsBefore = readBulletArray(formData, "content.itemsBefore", 10);
  if (itemsBefore.length > 0) coverContent.itemsBefore = itemsBefore;
  const itemsAfter = readBulletArray(formData, "content.itemsAfter", 15);
  if (itemsAfter.length > 0) coverContent.itemsAfter = itemsAfter;

  // Block state: cada checkbox llega como `block.<id>` (presente = on).
  // IDs desconocidos se descartan (defensa contra tampering).
  const blockState: Partial<StudioBlockState> = {};
  for (const id of STUDIO_BLOCK_IDS) {
    if (formData.has(`block.${id}`)) {
      blockState[id] = true;
    }
  }
  // IDs explícitamente en `false` no se envían (no están en formData);
  // los que NO están en formData los tratamos como "no tocados" — el use
  // case los rellena con `false` y `applyBlockState` los deja como están.

  const result = await makeSaveCoverStudio().execute({
    actor,
    bundleId,
    theme,
    coverContent,
    blockState,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-studio`);
  revalidatePath("/print", "layout");
  return { success: true };
}
