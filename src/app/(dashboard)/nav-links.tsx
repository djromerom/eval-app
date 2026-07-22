"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavLink {
  href: string;
  label: string;
}

/**
 * Lista de navegación con resaltado del item activo según la ruta actual.
 * Puramente presentacional: recibe los items ya filtrados por capability
 * desde el layout (servidor); no decide visibilidad ni permisos.
 */
export function NavLinks({ items }: { items: NavLink[] }) {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (pathname === href) return true;
    // Rutas hijas (p. ej. /teacher/evaluations/123) marcan activo al padre,
    // salvo los "Panel" raíz de cada sección para no colisionar entre sí.
    const isSectionRoot = href.split("/").length <= 2;
    return !isSectionRoot && pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
