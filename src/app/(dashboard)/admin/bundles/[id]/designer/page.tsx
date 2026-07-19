import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { getResolvedBundleTheme } from "@/modules/theme/application/get-resolved-bundle-theme";
import { parseEvaluationTheme } from "@/modules/theme/domain/theme";
import { BundleDesignerForm } from "./designer-form";

export const metadata: Metadata = { title: "Diseñador del compendio" };

export const dynamic = "force-dynamic";

/**
 * Pestaña Diseñador — override del tema por compendio + preview iframe
 * de la maqueta del cuadernillo.
 *
 * El SUPER_ADMIN puede ajustar subtítulo, pie, color, tipografía, densidad,
 * separador y bloque intro. Solo en DRAFT (validado en UpdateBundleTheme).
 *
 * Diferencias con el designer de evaluation:
 * - Auth: solo SUPER_ADMIN (los compendios son multi-evaluación, no
 *   pertenecen a un solo docente).
 * - Resolver: `getResolvedBundleTheme` mergea institución + override del
 *   bundle (no de la primera evaluation, como hacía el antiguo print).
 */
export default async function BundleDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const result = await makeGetBundle().execute({ actor, bundleId: id });
  if (!result.ok) notFound();
  const bundle = result.value;

  const editable = bundle.status === "DRAFT";
  const override = parseEvaluationTheme(bundle.theme);
  const resolved = await getResolvedBundleTheme(actor.institutionId, bundle.id);

  return (
    <>
      <PageHeader
        title={`Diseñador — ${bundle.name}`}
        description="Personaliza el cuadernillo de este compendio. Los cambios se ven inmediatamente en la vista previa."
      />

      <div className="mb-4 flex items-center gap-3 text-sm">
        <Link
          href={`/admin/bundles/${bundle.id}`}
          className="text-muted-foreground hover:underline"
        >
          ← Volver al compendio
        </Link>
        <Link
          href={`/print/bundle/${bundle.id}`}
          target="_blank"
          className="text-muted-foreground hover:underline"
        >
          Abrir cuadernillo en pestaña nueva ↗
        </Link>
      </div>

      <BundleDesignerForm
        bundleId={bundle.id}
        initial={override}
        resolved={resolved}
        editable={editable}
      />
    </>
  );
}
