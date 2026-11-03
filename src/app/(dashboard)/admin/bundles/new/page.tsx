import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import {
  makeListCourses,
  makeListPeriods,
  makeGetCurrentPeriod,
} from "@/modules/academic/infrastructure/container";
import { makeListBookletTypesByInstitution } from "@/modules/booklet-types/infrastructure/container";
import { CreateBundleWizard } from "./wizard-form";

export const metadata: Metadata = { title: "Nuevo cuadernillo" };

export const dynamic = "force-dynamic";

/**
 * Wizard de creación de cuadernillos. Lista las formulaciones APPROVED/PUBLISHED
 * de la institución (las únicas que se pueden incluir) y deja al SUPER_ADMIN
 * armar la selección, asignar nombre y bookletNumber.
 *
 * Sprint Bundle-Period (sep 2026): carga también periodos + tipos de cuadernillo
 * para que el wizard pueda preseleccionar la Prueba actual y aplicar la cascada
 * Period → BookletType.
 */
export default async function NewBundlePage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER", "ECU_LIDER");

  const [approved, published, coursesRes, periodsRes, bookletTypesRes, currentPeriodRes] =
    await Promise.all([
      makeListEvaluations().execute({ actor, status: "APPROVED" }),
      makeListEvaluations().execute({ actor, status: "PUBLISHED" }),
      makeListCourses().execute({ actor }),
      makeListPeriods().execute({ actor }),
      makeListBookletTypesByInstitution().execute({ actor }),
      makeGetCurrentPeriod().execute({ actor }),
    ]);

  // La prueba actual la resuelve el servidor con la regla year-aware
  // (`GetCurrentPeriod`): `isCurrent` es una marca por año académico, así que
  // buscar "el primero de la lista" podía devolver la prueba de un año ya
  // cerrado (y bloquear el select de Prueba en esa).
  const currentPeriod = currentPeriodRes.ok ? currentPeriodRes.value : null;

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
  const periods = periodsRes.ok
    ? periodsRes.value.map((p) => ({
        id: p.id,
        name: p.name,
        academicYearId: p.academicYearId,
        isCurrent: p.isCurrent,
      }))
    : [];
  const bookletTypes = bookletTypesRes.ok
    ? bookletTypesRes.value.map((bt) => ({ id: bt.id, periodId: bt.periodId, name: bt.name }))
    : [];

  return (
    <>
      <PageHeader
        title="Nuevo cuadernillo"
        description="Agrupa formulaciones aprobadas o publicadas en un cuadernillo único."
      />
      <CreateBundleWizard
        evaluations={evaluations}
        courses={courses}
        periods={periods}
        bookletTypes={bookletTypes}
        currentPeriodId={currentPeriod?.id ?? null}
      />
    </>
  );
}
