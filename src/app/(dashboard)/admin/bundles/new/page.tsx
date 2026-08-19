import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListCourses } from "@/modules/academic/infrastructure/container";
import { CreateBundleWizard } from "./wizard-form";

export const metadata: Metadata = { title: "Nuevo cuadernillo" };

export const dynamic = "force-dynamic";

/**
 * Wizard de creación de cuadernillos. Lista las formulaciones APPROVED/PUBLISHED
 * de la institución (las únicas que se pueden incluir) y deja al SUPER_ADMIN
 * armar la selección, asignar nombre y bookletNumber.
 */
export default async function NewBundlePage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const [approved, published, coursesRes] = await Promise.all([
    makeListEvaluations().execute({ actor, status: "APPROVED" }),
    makeListEvaluations().execute({ actor, status: "PUBLISHED" }),
    makeListCourses().execute({ actor }),
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

  const courses = coursesRes.ok ? coursesRes.value.map((c) => ({ id: c.id, name: c.name })) : [];

  return (
    <>
      <PageHeader
        title="Nuevo cuadernillo"
        description="Agrupa formulaciones aprobadas o publicadas en un cuadernillo único."
      />
      <CreateBundleWizard evaluations={evaluations} courses={courses} />
    </>
  );
}
