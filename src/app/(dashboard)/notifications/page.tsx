import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import {
  makeListNotifications,
  makeMarkNotificationsRead,
} from "@/modules/notifications/infrastructure/container";
import { revalidatePath } from "next/cache";

export const metadata: Metadata = { title: "Notificaciones" };

const df = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

const TYPE_LABELS: Record<string, string> = {
  EVALUATION_PENDING_REVIEW: "Pendiente de revisión",
  EVALUATION_APPROVED: "Evaluación aprobada",
  EVALUATION_REJECTED: "Evaluación rechazada",
  SCANNING_COMPLETED: "Escaneo completado",
  SCANNING_ERROR: "Error de escaneo",
  NEW_STUDENT_ASSIGNED: "Nuevo estudiante asignado",
};

async function markAllReadAction() {
  "use server";
  const actor = await requireAuthenticatedUser();
  await makeMarkNotificationsRead().execute({ actor });
  revalidatePath("/notifications");
}

export default async function NotificationsPage() {
  const actor = await requireAuthenticatedUser();
  const res = await makeListNotifications().execute({ actor });
  const notifications = res.ok ? res.value : [];

  const unread = notifications.filter((n) => !n.isRead);

  return (
    <>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notificaciones</h1>
          <p className="text-muted-foreground mt-1 text-sm">{unread.length} sin leer</p>
        </div>
        {unread.length > 0 && (
          <form action={markAllReadAction}>
            <Button type="submit" variant="outline" size="sm">
              Marcar todas como leídas
            </Button>
          </form>
        )}
      </div>

      <div className="space-y-2">
        {notifications.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay notificaciones.</p>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`bg-card flex items-start gap-3 rounded-xl border p-4 ${
                !n.isRead ? "border-l-primary border-l-2" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {TYPE_LABELS[n.type] ?? n.type}
                  </span>
                  {!n.isRead && <span className="bg-primary h-2 w-2 rounded-full" />}
                </div>
                <p className="mt-1 text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-muted-foreground mt-0.5 text-sm">{n.body}</p>}
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-muted-foreground text-xs">
                    {df.format(new Date(n.createdAt))}
                  </span>
                  {n.link && (
                    <Link
                      href={n.link}
                      className="text-primary text-xs font-medium hover:underline"
                    >
                      Ver detalles →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
