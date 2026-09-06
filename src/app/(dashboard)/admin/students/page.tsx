import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListGroups } from "@/modules/academic/infrastructure/container";
import { makeListStudents } from "@/modules/students/infrastructure/container";
import { StudentsKpiStrip } from "./_components/students-kpi-strip";
import { StudentsPageClient } from "./_components/students-page-client";

export const metadata: Metadata = { title: "Estudiantes" };

/**
 * Página principal de `admin/students` (Fase 12).
 *
 * Server component que:
 * 1) Autentica + carga el listado de estudiantes y grupos de la institución.
 * 2) Calcula las 4 stats del KPI strip (total / activos / grupos usados /
 *    ingresados este año) en server.
 * 3) Pasa los datos al cliente (`<StudentsPageClient>`) que se encarga de
 *    búsqueda, filtros, sort, tabla densa y drawers/inline forms vía
 *    query params (`?new=1`, `?import=1`, `/[id]/edit`).
 *
 * La sub-ruta `/[id]/edit` renderiza el drawer de edición encima de esta
 * misma página (patrón `Admin · Edit Period drawer`).
 */
export default async function StudentsPage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const [studentsRes, groupsRes] = await Promise.all([
    makeListStudents().execute({ actor }),
    makeListGroups().execute({ actor }),
  ]);

  const students = studentsRes.ok ? studentsRes.value : [];
  const groups = groupsRes.ok ? groupsRes.value : [];
  const currentYear = new Date().getFullYear();

  // ===== Stats del KPI strip =====
  const active = students.filter((s) => s.isActive).length;
  const groupsUsed = new Set(
    students.map((s) => s.currentEnrollment?.groupId).filter((g): g is string => Boolean(g)),
  ).size;
  const enrolledThisYear = students.filter((s) => s.enrollmentYear === currentYear).length;

  // ===== Lookup para que la tabla cliente renderice nombres de grupo =====
  const groupsById: Record<string, string> = {};
  const groupsOptions: { value: string; label: string }[] = [];
  for (const g of groups) {
    groupsById[g.id] = g.name;
    groupsOptions.push({ value: g.id, label: g.name });
  }

  return (
    <>
      <PageHeader
        title="Estudiantes"
        description="Gestiona los estudiantes de tu institución. El código va embebido en el QR."
      />

      <StudentsKpiStrip
        total={students.length}
        active={active}
        groupsUsed={groupsUsed}
        enrolledThisYear={enrolledThisYear}
        currentYear={currentYear}
      />

      {/* `useSearchParams` requiere Suspense en producción */}
      <Suspense fallback={null}>
        <StudentsPageClient
          students={students}
          groups={{ byId: groupsById, options: groupsOptions }}
          currentYear={currentYear}
        />
      </Suspense>
    </>
  );
}
