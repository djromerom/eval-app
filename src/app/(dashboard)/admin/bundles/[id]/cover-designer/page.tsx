import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import {
  makeLoadCoverDesigner,
  makePreviewCover,
} from "@/modules/bundle-cover/infrastructure/container";
import { parseCoverContent } from "@/modules/bundle-cover/domain/cover-content";
import { getResolvedCoverContent } from "@/modules/bundle-cover/application/get-resolved-cover-content";
import { extractCoverContentFields } from "@/modules/bundle-cover/domain/template-fields";
import { getResolvedBundleTheme } from "@/modules/theme/application/get-resolved-bundle-theme";
import { parseEvaluationTheme } from "@/modules/theme/domain/theme";
import { CoverDesignerForm } from "./cover-designer-form";

export const metadata: Metadata = { title: "Diseñador de portada" };

export const dynamic = "force-dynamic";

/**
 * Pestaña Diseñador de portada — formulario completo con Monaco editor.
 *
 * El server:
 *   1. Carga el bundle (404 si no existe).
 *   2. Carga el estado de la plantilla (`LoadCoverDesigner`) — key efectiva,
 *      source, updatedAt, editorBody, builtinBody, availableKeys.
 *   3. Pinta el preview sanitizado (`PreviewCover`).
 *   4. Resuelve el coverContent del compendio colapsado con el institucional
 *      (`getResolvedCoverContent`) — PR 2/4.
 *   5. Delega la UI interactiva al cliente (`<CoverDesignerForm>`), que
 *      maneja las server actions (Save / Reset / ChangeKey / CoverContent).
 *
 * Si falla cualquiera de los pasos, 404.
 */
export default async function BundleCoverDesignerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const bundleResult = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleResult.ok) notFound();
  const bundle = bundleResult.value;

  const stateResult = await makeLoadCoverDesigner().execute({ actor, bundleId: id });
  if (!stateResult.ok) notFound();
  const initial = stateResult.value;

  const previewResult = await makePreviewCover().execute({ actor, bundleId: id });
  if (!previewResult.ok) notFound();
  const previewHtml = previewResult.value.html;

  const editable = bundle.status === "DRAFT";
  const initialTheme = parseEvaluationTheme(bundle.theme);
  const resolvedTheme = await getResolvedBundleTheme(actor.institutionId, bundle.id);

  // PR 4: coverContent del compendio + colapsado (para la sección
  // "Contenido de portada" del form). `parseCoverContent` es defensivo —
  // si el JSONB está corrupto, devuelve {} y la UI parte de los defaults.
  const initialCoverContent = parseCoverContent(bundle.coverContent);
  const resolvedCoverContent = await getResolvedCoverContent(actor.institutionId, bundle.id);

  // PR 5: extraer del HTML activo (built-in si no hay override, override si
  // existe) las variables Mustache del schema que esta plantilla usa — la
  // sección "Contenido de portada" genera inputs solo para esos campos.
  const coverContentFields = extractCoverContentFields(initial.editorBody);

  return (
    <>
      <PageHeader
        title={`Diseñador de portada — ${bundle.name}`}
        description="Edita el HTML de la portada, sube un archivo o cambia la variante. El preview se renderiza con los datos vigente del cuadernillo."
      />
      <CoverDesignerForm
        bundleId={bundle.id}
        bundleName={bundle.name}
        initial={initial}
        previewHtml={previewHtml}
        initialTheme={initialTheme}
        resolvedTheme={resolvedTheme}
        initialCoverContent={initialCoverContent}
        resolvedCoverContent={resolvedCoverContent}
        coverContentFields={coverContentFields}
        editable={editable}
      />
    </>
  );
}
