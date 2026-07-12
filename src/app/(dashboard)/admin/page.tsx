import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Panel de administración" };

export default async function AdminDashboardPage() {
  await requireAuthenticatedUser("SUPER_ADMIN", "ADMIN");

  return (
    <>
      <PageHeader
        title="Panel de administración"
        description="Gestiona instituciones, usuarios, cursos y asignaturas."
      />
      <p className="text-muted-foreground text-sm">
        {/* TODO Fase 1: tarjetas de resumen (instituciones activas, usuarios, evaluaciones) */}
        Módulo en construcción.
      </p>
    </>
  );
}
