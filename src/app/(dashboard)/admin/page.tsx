import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
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
        <StatCard
          label="Usuarios activos"
          value={usersCount}
          hint={
            <Link href="/admin/users" className="text-primary hover:underline">
              Gestionar →
            </Link>
          }
        />
        <StatCard
          label="Docentes"
          value={teachersCount}
          hint={
            <Link href="/admin/teachers" className="text-primary hover:underline">
              Gestionar →
            </Link>
          }
        />
        <StatCard
          label="Estudiantes"
          value={studentsCount}
          hint={
            <Link href="/admin/students" className="text-primary hover:underline">
              Gestionar →
            </Link>
          }
        />
        <StatCard label="Evaluaciones" value={evaluationsCount} accent />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            href: "/admin/academic",
            title: "Estructura académica",
            desc: "Gestiona cursos, asignaturas, grupos y periodos.",
          },
          {
            href: "/admin/students",
            title: "Importar estudiantes",
            desc: "Carga masiva desde CSV/Excel con validación.",
          },
          {
            href: "/admin/teachers",
            title: "Asignar docentes",
            desc: "Crea usuarios docentes y asígnalos a cursos.",
          },
        ].map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="bg-card hover:border-primary/40 group rounded-xl border p-5 shadow-sm transition-colors"
          >
            <h3 className="font-display group-hover:text-primary font-semibold transition-colors">
              {c.title}
            </h3>
            <p className="text-muted-foreground mt-1 text-sm">{c.desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
