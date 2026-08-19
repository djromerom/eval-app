import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeListEvaluations } from "@/modules/evaluations/infrastructure/container";
import { makeListLeaderAssignments } from "@/modules/leader-assignments/infrastructure/container";

export const metadata: Metadata = { title: "Panel de coordinación" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

export default async function CoordinatorDashboardPage() {
  const actor = await requireAuthenticatedUser("ECU_LIDER");

  // Las formulaciones pasan por el use case ListEvaluations → el scope
  // filter del Líder ECU se aplica aquí (solo cursos asignados). Los KPIs
  // de docentes/estudiantes siguen siendo institucionales (no por líder).
  const [inReviewRes, approvedRes, assignmentsRes, teachersCount, studentsCount] =
    await Promise.all([
      makeListEvaluations().execute({ actor, status: "IN_REVIEW" }),
      makeListEvaluations().execute({ actor, status: "APPROVED" }),
      makeListLeaderAssignments().execute({ actor }),
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
  const inReview = inReviewRes.ok ? inReviewRes.value : [];
  const approved = approvedRes.ok ? approvedRes.value : [];
  const assignments = assignmentsRes.ok ? assignmentsRes.value : [];
  const hasNoAssignments = assignments.length === 0;

  return (
    <>
      <PageHeader
        title="Panel de coordinación"
        description="Revisa y aprueba las formulaciones enviadas por los docentes."
      />

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Pendientes" value={inReview.length} accent />
        <StatCard label="Aprobadas" value={approved.length} />
        <StatCard label="Docentes" value={teachersCount} />
        <StatCard label="Estudiantes" value={studentsCount} />
      </div>

      <div className="mb-8">
        <Link href="/coordinator/review">
          <Button size="sm">Ir a revisión</Button>
        </Link>
      </div>

      {/* Aviso: el líder no tiene cursos asignados todavía. Sin esta nota,
          la lista vacía de pendientes se confunde con "no hay nada que
          revisar" y el docente no sabe que tiene que pedir la asignación
          al admin. (ago 2026, feat/lider-ecu §3.6) */}
      {hasNoAssignments && (
        <p className="bg-muted/40 mb-6 rounded-lg border px-4 py-3 text-sm">
          Aún no tienes cursos asignados. Pide al administrador que te asigne
          uno en <span className="font-medium">/admin/leader-assignments</span>{" "}
          para ver aquí las formulaciones de tus cursos.
        </p>
      )}

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
                    {e.teacherName} · {e.courseName} · {e.subjectName} · v
                    {e.version}
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