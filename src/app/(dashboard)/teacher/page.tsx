import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge } from "@/components/evaluations/status-badge";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeGetCurrentPeriod } from "@/modules/academic/infrastructure/container";

export const metadata: Metadata = { title: "Panel del docente" };

const df = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

/**
 * Panel del docente (Fase 12+).
 *
 * Oculto del TEACHER:
 * - "Plantillas" y "Escanear" del menú lateral (ver `(dashboard)/layout.tsx`,
 *   filtro `roles` en NavItem).
 * - En esta página: el KPI "Hojas escaneadas", los botones "Plantillas" /
 *   "Escanear hojas" y la sección "Últimos escaneos".
 *
 * El docente sigue viendo sus formulaciones (crear, recientes) y el banco
 * de preguntas. Las funciones de plantillas y escaneo son para coordinador
 * (que las descubre desde el menú lateral).
 */
export default async function TeacherDashboardPage() {
  const actor = await requireAuthenticatedUser("TEACHER");

  // El panel se acota a la PRUEBA ACTUAL, igual que "Mis formulaciones": el
  // panel y la lista a la que enlaza tienen que hablar de la misma prueba.
  const currentPeriodRes = await makeGetCurrentPeriod().execute({ actor });
  const currentPeriod = currentPeriodRes.ok ? currentPeriodRes.value : null;

  const [currentUser, evaluations, unreadNotifications] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    }),
    prisma.evaluation.findMany({
      where: {
        institutionId: actor.institutionId,
        teacherId: actor.userId,
        deletedAt: null,
        ...(currentPeriod ? { periodId: currentPeriod.id } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: {
        courseSubject: {
          include: { course: { select: { name: true } }, subject: { select: { name: true } } },
        },
      },
    }),
    prisma.notification.count({
      where: { userId: actor.userId, isRead: false },
    }),
  ]);

  const draftCount = evaluations.filter((e) => e.status === "DRAFT").length;
  const inReviewCount = evaluations.filter((e) => e.status === "IN_REVIEW").length;
  const publishedCount = evaluations.filter((e) => e.status === "PUBLISHED").length;

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
          Crea formulaciones y gestiona tu banco de preguntas.
        </p>
      </header>

      {/* KPIs */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <StatCard label="Borradores" value={draftCount} />
        <StatCard label="En revisión" value={inReviewCount} />
        <StatCard label="Publicadas" value={publishedCount} accent />
      </div>

      {/* Unread notifications banner */}
      {unreadNotifications > 0 ? (
        <Link
          href="/notifications"
          className="bg-brand-blue-tint text-primary mb-6 flex items-center gap-2 rounded-xl p-4 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <span className="bg-primary h-2 w-2 rounded-full" />
          Tienes {unreadNotifications} notificación{unreadNotifications !== 1 ? "es" : ""} sin leer
        </Link>
      ) : null}

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link href="/teacher/evaluations">
          <Button size="sm">+ Nueva formulación</Button>
        </Link>
      </div>

      <section className="bg-card rounded-xl border p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Formulaciones recientes</h3>
          <Link
            href="/teacher/evaluations"
            className="text-primary text-sm font-medium hover:underline"
          >
            Ver todas →
          </Link>
        </div>
        {evaluations.length === 0 ? (
          <p className="text-muted-foreground text-sm">Crea tu primera formulación.</p>
        ) : (
          <div className="space-y-1">
            {evaluations.slice(0, 10).map((e) => (
              <Link
                key={e.id}
                href={`/teacher/evaluations/${e.id}/unified`}
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
    </>
  );
}
