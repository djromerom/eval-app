/**
 * Página server: Cover HTML (4ª vista de portada — editor HTML Live, ago 2026).
 * =============================================================================
 *
 * Punto de entrada para `/admin/bundles/:id/cover-html`. Server component
 * que:
 *
 *   1. Verifica autenticación + permisos (manage-bundles).
 *   2. Carga el `EvaluationBundle` por id + institutionId.
 *   3. Carga el HTML live (`LoadCoverHtml`) — puede ser null.
 *   4. Genera el preview server-side (`PreviewCover`) — pasa por el mismo
 *      pipeline que las otras 3 vistas. Si hay HTML live, rutea a
 *      `RenderCoverHtml` (PR 5 — cover-html).
 *   5. Renderiza `CoverHtmlForm` con todo lo necesario.
 *
 * ## Render precedence (cubierto en `preview-cover.ts`)
 *
 *   live → visual → HTML override → built-in
 *
 * Si el bundle tiene `coverLiveProject`, el preview server-side usa ese
 * HTML. Cuando el docente guarde, el preview se actualiza.
 *
 * ## 404 si el bundle no existe en esta institución
 */
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makePreviewCover } from "@/modules/bundle-cover/infrastructure/container";
import { makeLoadCoverHtml } from "@/modules/cover-html/infrastructure/container";
import { CoverHtmlForm } from "./cover-html-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CoverHtmlPage({ params }: PageProps) {
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

  const liveResult = await makeLoadCoverHtml().execute({
    actor,
    bundleId,
  });
  if (!liveResult.ok) {
    throw liveResult.error;
  }

  const previewResult = await makePreviewCover().execute({
    actor,
    bundleId,
  });
  if (!previewResult.ok) {
    throw previewResult.error;
  }

  const editable = bundle.status === "DRAFT";

  // Mismo truco: si el preview server-side retorna source="OVERRIDE",
  // significa que hay `coverTemplateBody` (override HTML de Monaco).
  const hasHtmlOverride = previewResult.value.source === "OVERRIDE";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Editor HTML live</h1>
        <p className="text-muted-foreground text-sm">
          Edita el HTML de la portada directamente. Los cambios persisten al pulsar Guardar.
        </p>
      </header>

      <CoverHtmlForm
        bundleId={bundleId}
        bundleName={bundle.name}
        initialHtml={liveResult.value.project?.html ?? null}
        editable={editable}
        hasHtmlOverride={hasHtmlOverride}
      />
    </div>
  );
}
