import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { prisma } from "@/shared/infrastructure/db/prisma";

export const metadata: Metadata = { title: "Panel del docente" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

export default async function TeacherDashboardPage() {
  const actor = await requireAuthenticatedUser("TEACHER");

  const [evaluations, recentBatches, unreadNotifications] = await Promise.all([
    prisma.evaluation.findMany({
      where: { institutionId: actor.institutionId, teacherId: actor.userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: {
        courseSubject: {
          include: { course: { select: { name: true } }, subject: { select: { name: true } } },
        },
      },
    }),
    prisma.scanBatch.findMany({
      where: { institutionId: actor.institutionId, uploadedBy: actor.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { evaluation: { select: { title: true } } },
    }),
    prisma.notification.count({
      where: { userId: actor.userId, isRead: false },
    }),
  ]);

  const draftCount = evaluations.filter((e) => e.status === "DRAFT").length;
  const inReviewCount = evaluations.filter((e) => e.status === "IN_REVIEW").length;
  const publishedCount = evaluations.filter((e) => e.status === "PUBLISHED").length;
  const totalSheets = recentBatches.reduce((s, b) => s + b.totalSheets, 0);
  const processedSheets = recentBatches.reduce((s, b) => s + b.processedSheets, 0);

  return (
    <>
      <PageHeader
        title="Panel del docente"
        description="Crea evaluaciones, gestiona tu banco de preguntas y escanea hojas de respuesta."
      />

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Borradores
          </p>
          <p className="mt-1 text-2xl font-bold">{draftCount}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            En revisión
          </p>
          <p className="mt-1 text-2xl font-bold">{inReviewCount}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Publicadas
          </p>
          <p className="mt-1 text-2xl font-bold">{publishedCount}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Hojas escaneadas
          </p>
          <p className="mt-1 text-2xl font-bold">
            {processedSheets}/{totalSheets}
          </p>
        </div>
      </div>

      {/* Unread notifications banner */}
      {unreadNotifications > 0 && (
        <Link
          href="/notifications"
          className="bg-primary/10 text-primary mb-6 flex items-center gap-2 rounded-xl border p-4 text-sm font-medium hover:underline"
        >
          <span className="bg-primary h-2 w-2 rounded-full" />
          Tienes {unreadNotifications} notificación{unreadNotifications !== 1 ? "es" : ""} sin leer
        </Link>
      )}

      <div className="mb-6 flex items-center gap-3">
        <Link href="/teacher/evaluations/new">
          <Button size="sm">Nueva evaluación</Button>
        </Link>
        <Link href="/teacher/templates">
          <Button variant="outline" size="sm">
            Plantillas
          </Button>
        </Link>
        <Link href="/teacher/scan">
          <Button variant="outline" size="sm">
            Escanear hojas
          </Button>
        </Link>
      </div>

      {/* Recent evaluations */}
      <section className="bg-card mb-8 rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Evaluaciones recientes</h3>
          <Link href="/teacher/evaluations" className="text-primary text-sm hover:underline">
            Ver todas →
          </Link>
        </div>
        {evaluations.length === 0 ? (
          <p className="text-muted-foreground text-sm">Crea tu primera evaluación.</p>
        ) : (
          <div className="divide-y">
            {evaluations.slice(0, 10).map((e) => (
              <Link
                key={e.id}
                href={`/teacher/evaluations/${e.id}`}
                className="flex items-center gap-3 py-3 hover:opacity-80"
              >
                <StatusBadge status={e.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {e.courseSubject.course.name} · {e.courseSubject.subject.name}
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

      {/* Recent scan batches */}
      <section className="bg-card rounded-xl border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Últimos escaneos</h3>
          <Link href="/teacher/scan" className="text-primary text-sm hover:underline">
            Ver todos →
          </Link>
        </div>
        {recentBatches.length === 0 ? (
          <p className="text-muted-foreground text-sm">No has escaneado hojas todavía.</p>
        ) : (
          <div className="divide-y">
            {recentBatches.map((b) => (
              <div key={b.id} className="flex items-center gap-3 py-3 text-sm">
                <ScanStatusBadge status={b.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{b.evaluation?.title ?? "—"}</p>
                  {b.totalSheets > 0 && (
                    <p className="text-muted-foreground text-xs">
                      {b.processedSheets}/{b.totalSheets} hojas
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {df.format(new Date(b.createdAt))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
