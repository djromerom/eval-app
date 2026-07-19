import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/shared/infrastructure/db/prisma";

export const metadata: Metadata = { title: "Panel de administración" };

export default async function AdminDashboardPage() {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER");

  const [usersCount, teachersCount, studentsCount, evaluationsCount] = await Promise.all([
    prisma.user.count({ where: { institutionId: actor.institutionId, isActive: true } }),
    prisma.user.count({
      where: {
        institutionId: actor.institutionId,
        isActive: true,
        roles: { some: { role: "TEACHER" } },
      },
    }),
    prisma.student.count({ where: { institutionId: actor.institutionId, isActive: true } }),
    prisma.evaluation.count({ where: { institutionId: actor.institutionId, deletedAt: null } }),
  ]);

  return (
    <>
      <PageHeader
        title="Panel de administración"
        description="Gestiona instituciones, usuarios, cursos y asignaturas."
      />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Usuarios activos
          </p>
          <p className="mt-1 text-2xl font-bold">{usersCount}</p>
          <Link href="/admin/users" className="text-primary mt-1 block text-xs hover:underline">
            Gestionar →
          </Link>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Docentes
          </p>
          <p className="mt-1 text-2xl font-bold">{teachersCount}</p>
          <Link href="/admin/teachers" className="text-primary mt-1 block text-xs hover:underline">
            Gestionar →
          </Link>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Estudiantes
          </p>
          <p className="mt-1 text-2xl font-bold">{studentsCount}</p>
          <Link href="/admin/students" className="text-primary mt-1 block text-xs hover:underline">
            Gestionar →
          </Link>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Evaluaciones
          </p>
          <p className="mt-1 text-2xl font-bold">{evaluationsCount}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/admin/academic"
          className="bg-card hover:bg-accent rounded-xl border p-4 transition-colors"
        >
          <h3 className="font-semibold">Estructura académica</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Gestiona cursos, asignaturas, grupos y periodos.
          </p>
        </Link>
        <Link
          href="/admin/students"
          className="bg-card hover:bg-accent rounded-xl border p-4 transition-colors"
        >
          <h3 className="font-semibold">Importar estudiantes</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Carga masiva desde CSV/Excel con validación.
          </p>
        </Link>
        <Link
          href="/admin/teachers"
          className="bg-card hover:bg-accent rounded-xl border p-4 transition-colors"
        >
          <h3 className="font-semibold">Asignar docentes</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Crea usuarios docentes y asígnalos a cursos.
          </p>
        </Link>
      </div>
    </>
  );
}
