import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Panel del docente" };

export default async function TeacherDashboardPage() {
  await requireAuthenticatedUser("TEACHER");

  return (
    <>
      <PageHeader
        title="Panel del docente"
        description="Crea evaluaciones, gestiona tu banco de preguntas y escanea hojas de respuesta."
      />
      <p className="text-muted-foreground text-sm">
        {/* TODO Fase 2: listado de mis evaluaciones por estado y accesos rápidos */}
        Módulo en construcción.
      </p>
    </>
  );
}
