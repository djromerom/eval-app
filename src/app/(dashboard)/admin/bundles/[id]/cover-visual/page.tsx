/**
 * Página server: Cover Visual (editor GrapesJS).
 * ==============================================
 *
 * Punto de entrada para `/admin/bundles/:id/cover-visual`. Server component
 * que:
 *
 *   1. Verifica autenticación + permisos (manage-bundles).
 *   2. Carga el `EvaluationBundle` por id + institutionId.
 *   3. Carga el proyecto visual (`LoadCoverVisual`) — puede ser null.
 *   4. Genera el preview server-side (`PreviewCover`) — pasa por el mismo
 *      pipeline que `/cover-designer` y `/cover-studio`. Si hay proyecto
 *      visual, rutea a `RenderCoverVisual` (PR 2).
 *   5. Renderiza `CoverVisualForm` con todo lo necesario.
 *
 * ## Render precedence (cubierto en `preview-cover.ts`)
 *
 *   visual → HTML override → built-in
 *
 * Si el bundle tiene `coverTemplateBody`, el preview server-side usa ese
 * HTML (porque visual aún no persiste). Cuando el docente guarde el visual
 * (PR 4), el preview will switch al visual.
 *
 * ## 404 si el bundle no existe en esta institución
 */
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeLoadCoverVisual } from "@/modules/bundle-cover/infrastructure/container";
import { makePreviewCover } from "@/modules/bundle-cover/infrastructure/container";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { CoverVisualForm } from "./cover-visual-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CoverVisualPage({ params }: PageProps) {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");
  const { id: bundleId } = await params;

  const bundleResult = await makeGetBundle().execute({
    actor,
    bundleId,
  });
  if (!bundleResult.ok) {
    if (bundleResult.error.code === "NOT_FOUND") {
      notFound();
    }
    throw bundleResult.error;
  }
  const bundle = bundleResult.value;

  const visualResult = await makeLoadCoverVisual().execute({
    actor,
    bundleId,
  });
  if (!visualResult.ok) {
    throw visualResult.error;
  }

  const previewResult = await makePreviewCover().execute({
    actor,
    bundleId,
  });
  if (!previewResult.ok) {
    throw previewResult.error;
  }

  const editable = bundle.status === "DRAFT";
  // El preview usa la fuente correcta (visual → HTML → built-in). Si el
  // result.source es OVERRIDE, sabemos que el bundle tiene HTML override
  // independientemente del proyecto visual. (BundleDetail no expone
  // coverTemplateBody directamente — la fuente canónica es el PreviewCover.)
  const hasHtmlOverride = previewResult.value.source === "OVERRIDE";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Diseñar portada visual</h1>
        <p className="text-muted-foreground text-sm">
          Editor drag-and-drop basado en GrapesJS. Los cambios persisten al pulsar Guardar.
        </p>
      </header>

      <CoverVisualForm
        bundleId={bundleId}
        bundleName={bundle.name}
        initialProject={visualResult.value.project}
        previewHtml={previewResult.value.html}
        editable={editable}
        hasHtmlOverride={hasHtmlOverride}
      />
    </div>
  );
}
