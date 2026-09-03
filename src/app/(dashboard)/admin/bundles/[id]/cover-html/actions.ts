"use server";

/**
 * Server actions del Cover HTML (4ª vista, ago 2026).
 * ===================================================
 *
 * `saveCoverHtmlAction`  — persiste el HTML editable del iframe.
 * `resetCoverHtmlAction` — borra el HTML live (vuelve al override HTML o al built-in).
 *
 * Mismo patrón que `cover-studio/actions.ts`:
 * `requireAuthenticatedUser` + use case + `revalidatePath` + return state.
 *
 * ## Extracción de imágenes (ago 2026, actualizado sep 2026)
 *
 * Antes de Zod, el HTML pasa por `extractInlineAssets`:
 *   1. Los `<img src="data:image/...;base64,...">` se mueven a
 *      `institutions/{id}/cover-html/{bundleId}/{uuid}.{png|jpg|gif|webp|svg}`.
 *   2. El HTML slimmed (con `<img src="/api/uploads/...">`) va a Zod + use case.
 *
 * Los `<svg>...</svg>` inline NO se extraen desde sep 2026 (fix A): el
 * reemplazo `<svg>`→`<img>` destruía atributos (class, viewBox, fill) y
 * rompía los íconos al guardar. Persisten literales en `html`.
 *
 *   3. Los archivos del save ANTERIOR se borran del disco DESPUÉS de
 *      persistir el nuevo slimHtml, y SOLO los que el nuevo HTML ya no
 *      referencia (`computeOrphanAssets`) — así no acumulamos huérfanos
 *      Y evitamos la ventana en la que el iframe del navegador pide URLs
 *      borradas (HTTP cache miss → 404 → imagen rota).
 *
 * Si la extracción falla (TooManyInlineAssets / OversizedInlineAsset), el HTML
 * original llega al Zod igual (defensa-en-profundidad — los assets se
 * mantienen inline). El caller recibe el error específico. Los archivos
 * del save anterior quedan intactos en disco.
 *
 * ## Validación
 *
 * El FormData trae un único campo `html` con el string HTML completo
 * (output del iframe via postMessage). Validamos con Zod
 * (`coverLiveProjectSchema`) antes de pasar al use case — el use case
 * además valida size + isLocked + FORBIDDEN_TAG_PATTERNS.
 *
 * ## Revalidación
 *
 * Después de guardar/resettear, invalidamos:
 *   • `/admin/bundles/:id`               — el detail muestra badge del live.
 *   • `/admin/bundles/:id/cover-designer`, `/cover-studio` —
 *     las 2 vistas previas de portada (banners).
 *   • `/admin/bundles/:id/cover-html`    — la vista actual.
 *   • `/print` (layout)                  — si el cuadernillo se imprime.
 *
 * Así el docente ve el cambio en cualquier tab que tenga abierta.
 */
import { revalidatePath } from "next/cache";
import { unlink } from "node:fs/promises";
import { join, normalize } from "node:path";
import { requireAuthenticatedUser } from "@/lib/session";
import { env } from "@/config/env";
import {
  makeLoadCoverHtml,
  makeResetCoverHtml,
  makeSaveCoverHtml,
} from "@/modules/cover-html/infrastructure/container";
import { coverLiveProjectSchema } from "@/modules/cover-html/domain/cover-html-schema";
import { toCoverLiveProject } from "@/modules/cover-html/domain/cover-html";
import {
  extractInlineAssets,
  isExtractInlineAssetsError,
} from "@/modules/cover-html/application/extract-inline-assets";
import { computeOrphanAssets } from "@/modules/cover-html/application/compute-orphan-assets";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";

export interface CoverHtmlFormState {
  status: "idle" | "success" | "error";
  error?: string;
}

/**
 * Borra archivos del storage local sin lanzar si no existen. Usado para
 * limpiar los SVGs extraídos en saves anteriores / antes del reset.
 *
 * Validamos que cada path caiga dentro de STORAGE_DIR (defensa contra
 * path traversal si el campo `extractedAssets` viene comprometido).
 */
async function safeUnlinkAll(relativePaths: string[]): Promise<void> {
  await Promise.all(
    relativePaths.map(async (relative) => {
      const full = normalize(join(env.STORAGE_DIR, relative));
      if (!full.startsWith(normalize(env.STORAGE_DIR))) {
        // Path traversal detectado — ignoramos silenciosamente. El path
        // solo debería contener `institutions/{id}/cover-html/...`, nunca
        // algo con `..`.
        return;
      }
      try {
        await unlink(full);
      } catch {
        // ENOENT u otro error: lo ignoramos. El siguiente save barre
        // cualquier huérfano que haya quedado.
      }
    }),
  );
}

/**
 * Persiste el HTML enviado desde el cliente (output del iframe editor).
 * El cliente manda el HTML como string en el campo `html`.
 *
 * Errores esperados (mapeados a `error` string):
 *   • HTML vacío.
 *   • ExtractInlineSvgs: TooManyInlineSvgs / OversizedSvg.
 *   • Zod: shape inválido (html no string).
 *   • Size limits del use case (< MIN o > MAX bytes UTF-8).
 *   • `isLocked` — bundle READY/PUBLISHED.
 *   • FORBIDDEN_TAG_PATTERNS — `<script>`, etc.
 *   • `FORBIDDEN` / `NOT_FOUND` del repositorio.
 */
export async function saveCoverHtmlAction(
  bundleId: string,
  _prev: CoverHtmlFormState,
  formData: FormData,
): Promise<CoverHtmlFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const raw = formData.get("html");
  const rawString = typeof raw === "string" ? raw : "";
  if (!rawString) {
    return { status: "error", error: "No se recibió el HTML del editor." };
  }

  // TEMP DEBUG (ago 2026): instrumentación pasiva para diagnosticar por qué
  // el usuario sigue viendo "String must contain at most 500000 character(s)"
  // tras añadir extractInlineAssets. Mide el HTML ANTES de extracción para
  // confirmar que llega al action, y el slim después.
  console.log("[cover-html-save] TEMP DEBUG raw HTML:", {
    bundleId,
    chars: rawString.length,
    bytesUtf8: Buffer.byteLength(rawString, "utf8"),
    svgMatches: (rawString.match(/<svg\b/gi) ?? []).length,
    imgMatches: (rawString.match(/<img\b/gi) ?? []).length,
    imgSrcSamples: (rawString.match(/<img\b[^>]*>/gi) ?? [])
      .slice(0, 3)
      .map((tag) =>
        (
          tag.match(/src\s*=\s*"([^"]*)"/i)?.[1] ??
          tag.match(/src\s*=\s*'([^']*)'/i)?.[1] ??
          ""
        ).slice(0, 120),
      ),
  });

  // Cargar el estado previo SOLO para recordar qué archivos se escribieron
  // en el save anterior. NO los borramos todavía — los borraremos AL FINAL,
  // después de persistir el nuevo slimHtml, y solo los que NO se referencian
  // en el nuevo HTML (`computeOrphanAssets`). Esto evita la ventana en la
  // que el iframe del navegador pide URLs borradas (HTTP cache miss →
  // 404 → imagen rota, ago 2026 — bug "save sin editar → portada rota").
  const priorState = await makeLoadCoverHtml().execute({ actor, bundleId });
  const priorExtracted: string[] =
    priorState.ok && priorState.value.state.hasProject
      ? (priorState.value.project?.extractedAssets ?? [])
      : [];

  // Extraer assets inline (SVGs + imágenes base64). Si falla (caps
  // excedidos), el caller recibe el error específico; el HTML original
  // queda intacto y vuelve al editor — y los archivos del save anterior
  // siguen en disco (la BD sigue apuntando a ellos), sin inconsistencias.
  let slimHtml = rawString;
  let extractedAssets: string[] = [];
  try {
    const extracted = await extractInlineAssets(rawString, {
      institutionId: actor.institutionId,
      bundleId,
      save: localStorage.save,
    });
    slimHtml = extracted.html;
    extractedAssets = extracted.extractedAssets;
  } catch (err) {
    // TEMP DEBUG: si la extracción tira, queremos saber si fue por caps
    // o por un error de FS.
    console.log("[cover-html-save] TEMP DEBUG extract FAILED:", {
      bundleId,
      errorName: err instanceof Error ? err.name : String(err),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    if (isExtractInlineAssetsError(err)) {
      return { status: "error", error: err.message };
    }
    throw err;
  }

  // TEMP DEBUG: confirma el tamaño POST-extracción que va al Zod.
  console.log("[cover-html-save] TEMP DEBUG after extract:", {
    bundleId,
    extractedCount: extractedAssets.length,
    slimChars: slimHtml.length,
    slimBytesUtf8: Buffer.byteLength(slimHtml, "utf8"),
  });

  // Zod valida el shape persistido (incluye `extractedAssets` opcional).
  const shape = coverLiveProjectSchema.safeParse({ html: slimHtml, extractedAssets });
  if (!shape.success) {
    // TEMP DEBUG: el shape falló. Necesitamos ver TODOS los issues, no
    // solo el primero, para entender si el cap de 500K chars sigue
    // siendo el problema o es otra cosa (extractedAssets con tipo malo,
    // por ejemplo).
    console.log("[cover-html-save] TEMP DEBUG Zod FAILED:", {
      bundleId,
      slimChars: slimHtml.length,
      slimBytesUtf8: Buffer.byteLength(slimHtml, "utf8"),
      issues: shape.error.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message,
      })),
    });
    return {
      status: "error",
      error: `Estructura inválida: ${shape.error.issues[0]?.message ?? "verifica el editor."}`,
    };
  }

  const project = toCoverLiveProject(shape.data);
  const result = await makeSaveCoverHtml().execute({
    actor,
    bundleId,
    project,
  });
  if (!result.ok) {
    return { status: "error", error: result.error.message };
  }

  // Tras persistir, calcular y borrar SOLO los archivos huérfanos: los
  // del save anterior que NO se referencian ni en el nuevo `slimHtml` ni
  // en `extractedAssets`. Ver `compute-orphan-assets.ts` para los casos
  // cubiertos (save CON editar, re-save sin editar, save con contenido
  // nuevo). El borrado se hace ANTES de revalidate para que el iframe
  // que va a recargarse tras la revalidación ya no pueda ver esos
  // archivos en el catálogo — pero los que SÍ se referencian siguen
  // disponibles en disco por si el iframe los re-pide.
  const orphans = computeOrphanAssets({
    priorExtracted,
    slimHtml,
    extractedAssets,
  });
  console.log("[cover-html-save] TEMP DEBUG orphan cleanup:", {
    bundleId,
    priorExtractedCount: priorExtracted.length,
    extractedAssetsCount: extractedAssets.length,
    orphansCount: orphans.length,
  });
  if (orphans.length > 0) {
    await safeUnlinkAll(orphans);
  }

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-studio`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-html`);
  revalidatePath("/print", "layout");
  return { status: "success" };
}

/**
 * Limpia el HTML live persistido. El render cae al HTML override (Monaco)
 * o al built-in. NO toca `coverTemplateBody` — solo el HTML live.
 *
 * Además borra los archivos SVG extraídos en el save anterior (cleanup
 * para que no queden huérfanos en disco).
 */
export async function resetCoverHtmlAction(
  bundleId: string,
  _prev: CoverHtmlFormState,
  _formData: FormData,
): Promise<CoverHtmlFormState> {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  // Cargar proyecto actual para conocer los assets a borrar ANTES del reset.
  // Si el load falla (FORBIDDEN, NOT_FOUND), propagamos — el reset no
  // tiene sentido si no podemos ver qué limpiar.
  const priorState = await makeLoadCoverHtml().execute({ actor, bundleId });
  const priorExtracted: string[] =
    priorState.ok && priorState.value.state.hasProject
      ? (priorState.value.project?.extractedAssets ?? [])
      : [];
  if (priorExtracted.length > 0) {
    await safeUnlinkAll(priorExtracted);
  }

  const result = await makeResetCoverHtml().execute({
    actor,
    bundleId,
  });
  if (!result.ok) {
    return { status: "error", error: result.error.message };
  }

  revalidatePath(`/admin/bundles/${bundleId}`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-designer`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-studio`);
  revalidatePath(`/admin/bundles/${bundleId}/cover-html`);
  revalidatePath("/print", "layout");
  return { status: "success" };
}
