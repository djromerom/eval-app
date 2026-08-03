import Link from "next/link";
import type { ReactNode } from "react";

export interface BreadcrumbItem {
  /** Etiqueta visible del item. */
  label: ReactNode;
  /** Si se omite, el item se renderiza como texto plano (current). */
  href?: string;
}

/**
 * Migas de pan estándar del dashboard. El último item siempre es el actual
 * (sin link, color foreground). Los items previos son links que cambian a
 * color foreground en hover. El separador es "/" sin espacios para no
 * añadir peso visual a algo puramente utilitario.
 *
 * Se ubica arriba del <PageHeader> en cada vista y reusa los tokens
 * tipográficos del repo (text-xs text-muted-foreground).
 *
 * Notas:
 *  - NO incluye <nav>/aria-label: ya lo hace la página padre si quiere
 *    semántica adicional. Mantenerlo minimal evita duplicación con los
 *    patrones existentes de header.
 *  - Sin cliente: Server Component puro, no requiere "use client".
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Ruta de navegación" className="mb-2 flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {item.href && !isLast ? (
              <Link
                href={item.href}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-foreground text-xs font-medium">{item.label}</span>
            )}
            {!isLast ? (
              <span aria-hidden className="text-muted-foreground/60 text-xs">
                /
              </span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}