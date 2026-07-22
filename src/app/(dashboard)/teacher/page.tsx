import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { prisma } from "@/shared/infrastructure/db/prisma";

export const metadata: Metadata = { title: "Panel del docente" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

export default async function TeacherDashboardPage() {
  const actor = await requireAuthenticatedUser("TEACHER");

  const [currentUser, evaluations, recentBatches, unreadNotifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    }),
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

  // Saludo con el primer nombre del docente (lo que esté antes del primer
  // espacio). Si el usuario no tiene nombre, cae al saludo genérico.
  const firstName = currentUser?.name?.split(" ")[0]?.trim();

  return (
    <>
      {/* Saludo */}
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {firstName ? `¡Hola de nuevo, ${firstName}!` : "¡Hola de nuevo!"}
        </h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Crea evaluaciones, gestiona tu banco de preguntas y escanea hojas de respuesta.
        </p>
      </header>

      {/* KPIs */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Borradores" value={draftCount} />
        <StatCard label="En revisión" value={inReviewCount} />
        <StatCard label="Publicadas" value={publishedCount} />
        <StatCard label="Hojas escaneadas" value={`${processedSheets}/${totalSheets}`} accent />
      </div>

      {/* Unread notifications banner */}
      {unreadNotifications > 0 && (
        <Link
          href="/notifications"
          className="bg-brand-blue-tint text-primary mb-6 flex items-center gap-2 rounded-xl p-4 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <span className="bg-primary h-2 w-2 rounded-full" />
          Tienes {unreadNotifications} notificación{unreadNotifications !== 1 ? "es" : ""} sin leer
        </Link>
      )}

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href="/teacher/evaluations/new">
          <Button size="sm">+ Nueva evaluación</Button>
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent evaluations */}
        <section className="bg-card rounded-xl border p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">Evaluaciones recientes</h3>
            <Link
              href="/teacher/evaluations"
              className="text-primary text-sm font-medium hover:underline"
            >
              Ver todas →
            </Link>
          </div>
          {evaluations.length === 0 ? (
            <p className="text-muted-foreground text-sm">Crea tu primera evaluación.</p>
          ) : (
            <div className="space-y-1">
              {evaluations.slice(0, 10).map((e) => (
                <Link
                  key={e.id}
                  href={`/teacher/evaluations/${e.id}`}
                  className="hover:bg-accent/60 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
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
        <section className="bg-card rounded-xl border p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">Últimos escaneos</h3>
            <Link href="/teacher/scan" className="text-primary text-sm font-medium hover:underline">
              Ver todos →
            </Link>
          </div>
          {recentBatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No has escaneado hojas todavía.</p>
          ) : (
            <div className="space-y-1">
              {recentBatches.map((b) => (
                <div key={b.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm">
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
      </div>
    </>
  );
}
