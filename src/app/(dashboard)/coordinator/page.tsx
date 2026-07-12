import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Panel de coordinación" };

export default async function CoordinatorDashboardPage() {
  await requireAuthenticatedUser("COORDINATOR");

  return (
    <>
      <PageHeader
        title="Panel de coordinación"
        description="Revisa y aprueba las evaluaciones enviadas por los docentes."
      />
      <p className="text-muted-foreground text-sm">
        {/* TODO Fase 2: bandeja de evaluaciones IN_REVIEW con aprobar/rechazar */}
        Módulo en construcción.
      </p>
    </>
  );
}
