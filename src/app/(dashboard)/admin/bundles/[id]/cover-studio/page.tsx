import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import {
  makeLoadCoverStudio,
  makePreviewCover,
} from "@/modules/bundle-cover/infrastructure/container";
import { parseCoverContent } from "@/modules/bundle-cover/domain/cover-content";
import { extractCoverContentFields } from "@/modules/bundle-cover/domain/template-fields";
import { getResolvedBundleTheme } from "@/modules/theme/application/get-resolved-bundle-theme";
import { parseEvaluationTheme } from "@/modules/theme/domain/theme";
import { CoverStudioForm } from "./cover-studio-form";

export const metadata: Metadata = { title: "Cover Studio" };

export const dynamic = "force-dynamic";

/**
 * Pestaña Cover Studio — vista paralela a cover-designer para aplicar
 * estilos (theme), contenido (coverContent) y toggles de bloques sobre
 * el HTML existente (ya escrito en `/cover-designer`).
 *
 * El server:
 *   1. Carga el bundle (404 si no existe).
 *   2. Carga el estado del Studio (`LoadCoverStudio` = `LoadCoverDesigner`
 *      + `identifyActiveBlocks(editorBody)`).
 *   3. Pinta el preview sanitizado (`PreviewCover`).
 *   4. Resuelve theme + coverContent colapsados para mostrar valores
 *      efectivos y permitir Heredar.
 *   5. Delega la UI al cliente (`<CoverStudioForm>`).
 *
 * Si falla cualquiera de los pasos, 404.
 */
export default async function BundleCoverStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const bundleResult = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleResult.ok) notFound();
  const bundle = bundleResult.value;

  const studioResult = await makeLoadCoverStudio().execute({ actor, bundleId: id });
  if (!studioResult.ok) notFound();
  const studio = studioResult.value;

  const previewResult = await makePreviewCover().execute({ actor, bundleId: id });
  if (!previewResult.ok) notFound();
  const previewHtml = previewResult.value.html;

  const editable = bundle.status === "DRAFT";
  const initialTheme = parseEvaluationTheme(bundle.theme);
  const resolvedTheme = await getResolvedBundleTheme(actor.institutionId, bundle.id);

  const initialCoverContent = parseCoverContent(bundle.coverContent);

  // Mismo set que cover-designer: campos del schema referenciados por la
  // plantilla activa. Si el docente cambió la plantilla en cover-designer,
  // aquí vemos el set actualizado.
  const coverContentFields = extractCoverContentFields(studio.editorBody);

  return (
    <>
      <PageHeader
        title={`Cover Studio — ${bundle.name}`}
        description="Aplica un tema, ajusta contenido y prende/apaga bloques. El HTML se edita en la pestaña Diseñador de portada."
      />
      <CoverStudioForm
        bundleId={bundle.id}
        bundleName={bundle.name}
        source={studio.state.source}
        templateKey={studio.state.key}
        initialBlockState={studio.blockState}
        initialTheme={initialTheme}
        resolvedTheme={resolvedTheme}
        initialCoverContent={initialCoverContent}
        coverContentFields={coverContentFields}
        previewHtml={previewHtml}
        editable={editable}
      />
    </>
  );
}
