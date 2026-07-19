import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { hasRole, type Role } from "@/shared/application/authenticated-user";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { PrismaNotificationReader } from "@/modules/notifications/infrastructure/prisma-notification-reader";

interface NavItem {
  href: string;
  label: string;
}

/** Navegación por rol. Cada rol ve solo lo que le corresponde (§2). */
function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function navFor(roles: Role[]): NavItem[] {
  const user = { userId: "", institutionId: "", roles };
  const items: NavItem[] = [];
  if (hasRole(user, "SUPER_ADMIN", "ADMIN")) {
    items.push(
      { href: "/admin", label: "Panel" },
      { href: "/admin/institutions", label: "Instituciones" },
      { href: "/admin/users", label: "Usuarios" },
      { href: "/admin/academic", label: "Estructura académica" },
      { href: "/admin/teachers", label: "Docentes" },
      { href: "/admin/students", label: "Estudiantes" },
      { href: "/admin/theme", label: "Tema institucional" },
    );
  }
  if (hasRole(user, "SUPER_ADMIN")) {
    // Los compendios multi-evaluación los arma el SUPER_ADMIN; el resto de
    // roles solo los consume (descarga PDF) desde /print.
    items.push({ href: "/admin/bundles", label: "Compendios" });
  }
  if (hasRole(user, "COORDINATOR")) {
    items.push(
      { href: "/coordinator", label: "Panel" },
      { href: "/coordinator/review", label: "Revisión" },
    );
  }
  if (hasRole(user, "TEACHER")) {
    items.push(
      { href: "/teacher", label: "Panel" },
      { href: "/teacher/evaluations", label: "Evaluaciones" },
      { href: "/teacher/templates", label: "Plantillas" },
      { href: "/teacher/question-bank", label: "Banco de preguntas" },
      { href: "/teacher/scan", label: "Escanear" },
    );
  }
  return items;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthenticatedUser();
  const items = navFor(user.roles);
  const reader = new PrismaNotificationReader();
  const unreadCount = await reader.countUnread(user.userId);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="bg-card flex w-60 shrink-0 flex-col border-r">
        <div className="px-6 py-5">
          <span className="text-lg font-bold">Eval</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground block rounded-md px-3 py-2 text-sm font-medium"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-2">
          <Link
            href="/notifications"
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium"
          >
            <BellIcon />
            <span>Notificaciones</span>
            {unreadCount > 0 && (
              <span className="bg-destructive text-destructive-foreground ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Link>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
              Cerrar sesión
            </Button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
