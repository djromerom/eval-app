import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { hasRole, type Role } from "@/shared/application/authenticated-user";
import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";

interface NavItem {
  href: string;
  label: string;
}

/** Navegación por rol. Cada rol ve solo lo que le corresponde (§2). */
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
    );
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
      { href: "/teacher/question-bank", label: "Banco de preguntas" },
      { href: "/teacher/scan", label: "Escanear" },
    );
  }
  return items;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthenticatedUser();
  const items = navFor(user.roles);

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
        <form action={logout} className="border-t p-3">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
            Cerrar sesión
          </Button>
        </form>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
