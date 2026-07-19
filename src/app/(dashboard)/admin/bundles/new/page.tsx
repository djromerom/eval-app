import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { CreateBundleWizard } from "./wizard-form";

export const metadata: Metadata = { title: "Nuevo compendio" };

export const dynamic = "force-dynamic";

/**
 * Wizard de creación de compendios. Lista las evaluaciones APPROVED/PUBLISHED
 * de la institución (las únicas que se pueden incluir) y deja al SUPER_ADMIN
 * armar la selección, asignar nombre y bookletNumber.
 */
export default async function NewBundlePage() {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");

  const [approved, published] = await Promise.all([
    makeListEvaluations().execute({ actor, status: "APPROVED" }),
    makeListEvaluations().execute({ actor, status: "PUBLISHED" }),
  ]);

  const candidates = [
    ...(approved.ok ? approved.value : []),
    ...(published.ok ? published.value : []),
  ];

  // Deduplicar por id (un PUBLISHED también aparece como APPROVED en algunos casos).
  const seen = new Set<string>();
  const evaluations = candidates.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  return (
    <>
      <PageHeader
        title="Nuevo compendio"
        description="Agrupa evaluaciones aprobadas o publicadas en un cuadernillo único."
      />
      <CreateBundleWizard evaluations={evaluations} />
    </>
  );
}
