import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { type Role } from "@/shared/application/authenticated-user";
import { can, type Capability } from "@/shared/application/capabilities";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { NavLinks } from "./nav-links";
import { PrismaNotificationReader } from "@/modules/notifications/infrastructure/prisma-notification-reader";

interface NavItem {
  href: string;
  label: string;
  /** Capability necesaria para ver el item. Sprint 8C: el menú ya no
   *  chequea roles directamente; consulta capabilities (ver
   *  `@/shared/application/capabilities`). Si mañana cambia quién puede
   *  gestionar bundles, solo se toca `can("manage-bundles", roles)` y
   *  este menú se actualiza sin editar `navFor`. */
  requires: Capability;
  /** Filtro opcional de roles: si está definido, el item SOLO se muestra
   *  cuando el actor tiene al menos uno de estos roles (la capability
   *  sigue siendo obligatoria). Útil para ocultar features del docente
   *  sin romper el capability global. */
  roles?: readonly Role[];
}

/** Navegación por capability. Cada item declara qué necesita; el menú
 *  filtra según los roles del actor. */
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

const NAV_ITEMS: readonly NavItem[] = [
  // Sección admin (SUPER_ADMIN y ECU_MASTER).
  { href: "/admin", label: "Panel", requires: "manage-users" },
  { href: "/admin/institutions", label: "Instituciones", requires: "manage-institutions" },
  { href: "/admin/users", label: "Usuarios", requires: "manage-users" },
  { href: "/admin/academic", label: "Estructura académica", requires: "manage-academic-structure" },
  { href: "/admin/teachers", label: "Docentes", requires: "manage-users" },
  { href: "/admin/students", label: "Estudiantes", requires: "manage-users" },
  { href: "/admin/theme", label: "Tema institucional", requires: "manage-institutional-theme" },
  // Cuadernillos: hoy ECU_MASTER. Si SUPER_ADMIN debe poder gestionarlos
  // (multi-rol), se añade a `can("manage-bundles", roles)` en
  // capabilities.ts — NO se toca este menú.
  { href: "/admin/bundles", label: "Cuadernillos", requires: "manage-bundles" },
  // Sección coordinador.
  { href: "/coordinator", label: "Panel", requires: "review-evaluations" },
  { href: "/coordinator/review", label: "Revisión", requires: "review-evaluations" },
  // Sección docente.
  { href: "/teacher", label: "Panel", requires: "create-evaluations" },
  { href: "/teacher/evaluations", label: "Mis Formulaciones", requires: "create-evaluations" },
  // Plantillas y escaneo: ocultos al TEACHER (solo COORDINATOR y superiores).
  {
    href: "/teacher/templates",
    label: "Plantillas",
    requires: "create-evaluations",
    roles: ["COORDINATOR", "ECU_MASTER"],
  },
  {
    href: "/teacher/question-bank",
    label: "Banco de preguntas",
    requires: "create-evaluations",
    roles: ["ECU_MASTER"],
  },
  {
    href: "/teacher/scan",
    label: "Escanear",
    requires: "create-evaluations",
    roles: ["COORDINATOR", "ECU_MASTER"],
  },
] as const;

function navFor(roles: Role[]): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!can(item.requires, roles)) return false;
    if (item.roles && !item.roles.some((r) => roles.includes(r))) return false;
    return true;
  });
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
      <aside className="bg-card sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-hidden border-r">
        <div className="px-5 py-5">
          <Link href="/" aria-label="ecognIA — inicio">
            <Logo markClassName="h-8" wordmarkClassName="text-xl" />
          </Link>
        </div>
        <NavLinks items={items} />
        <div className="shrink-0 border-t p-2">
          <Link
            href="/notifications"
            className="text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
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
