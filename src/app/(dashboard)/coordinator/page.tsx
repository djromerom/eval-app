import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/shared/infrastructure/db/prisma";

export const metadata: Metadata = { title: "Panel de coordinación" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

export default async function CoordinatorDashboardPage() {
  const actor = await requireAuthenticatedUser("COORDINATOR");

  const [inReview, approved, teachersCount, studentsCount] = await Promise.all([
    prisma.evaluation.findMany({
      where: { institutionId: actor.institutionId, status: "IN_REVIEW", deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        teacher: { select: { name: true } },
        courseSubject: {
          include: { course: { select: { name: true } }, subject: { select: { name: true } } },
        },
      },
    }),
    prisma.evaluation.count({
      where: { institutionId: actor.institutionId, status: "APPROVED", deletedAt: null },
    }),
    prisma.user.count({
      where: {
        institutionId: actor.institutionId,
        isActive: true,
        roles: { some: { role: "TEACHER" } },
      },
    }),
    prisma.student.count({
      where: { institutionId: actor.institutionId, isActive: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Panel de coordinación"
        description="Revisa y aprueba las formulaciones enviadas por los docentes."
      />

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pendientes" value={inReview.length} accent />
        <StatCard label="Aprobadas" value={approved} />
        <StatCard label="Docentes" value={teachersCount} />
        <StatCard label="Estudiantes" value={studentsCount} />
      </div>

      <div className="mb-8">
        <Link href="/coordinator/review">
          <Button size="sm">Ir a revisión</Button>
        </Link>
      </div>

      {/* Formulaciones pendientes */}
      <section className="bg-card rounded-xl border p-5 shadow-sm">
        <h3 className="font-display mb-4 text-lg font-semibold">
          Formulaciones pendientes de revisión ({inReview.length})
        </h3>
        {inReview.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay formulaciones pendientes de revisión.
          </p>
        ) : (
          <div className="space-y-1">
            {inReview.map((e) => (
              <Link
                key={e.id}
                href={`/teacher/evaluations/${e.id}/unified`}
                className="hover:bg-accent/60 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {e.teacher.name} · {e.courseSubject.course.name} ·{" "}
                    {e.courseSubject.subject.name} · v{e.version}
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {df.format(new Date(e.updatedAt))}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
