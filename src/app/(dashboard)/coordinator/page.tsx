import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
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
        description="Revisa y aprueba las evaluaciones enviadas por los docentes."
      />

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Pendientes
          </p>
          <p className="mt-1 text-2xl font-bold">{inReview.length}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Aprobadas
          </p>
          <p className="mt-1 text-2xl font-bold">{approved}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Docentes
          </p>
          <p className="mt-1 text-2xl font-bold">{teachersCount}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Estudiantes
          </p>
          <p className="mt-1 text-2xl font-bold">{studentsCount}</p>
        </div>
      </div>

      <div className="mb-6">
        <Link href="/coordinator/review">
          <Button size="sm">Ir a revisión</Button>
        </Link>
      </div>

      {/* Evaluaciones pendientes */}
      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-3 font-semibold">
          Evaluaciones pendientes de revisión ({inReview.length})
        </h3>
        {inReview.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay evaluaciones pendientes de revisión.
          </p>
        ) : (
          <div className="divide-y">
            {inReview.map((e) => (
              <Link
                key={e.id}
                href={`/teacher/evaluations/${e.id}`}
                className="flex items-center gap-3 py-3 hover:opacity-80"
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
