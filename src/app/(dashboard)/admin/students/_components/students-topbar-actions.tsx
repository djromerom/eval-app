"use client";

import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botones del topbar de `admin/students` (Fase 12). Sus CTAs empujan a la
 * misma ruta con query params que la página cliente interpreta para abrir
 * drawers/inline forms:
 *
 * - `?new=1`   → inline form de alta arriba de la tabla.
 * - `?import=1`→ drawer "Importar CSV".
 *
 * Mantenemos `<Link>` (no `router.push`) para preservar back/forward y
 * para que tras un submit exitoso el redirect limpie el query.
 */
export function StudentsTopbarActions() {
  return (
    <div className="flex items-center gap-2">
      <Link href="?import=1" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        <FileUp className="h-3.5 w-3.5" />
        Importar CSV
      </Link>
      <Link href="?new=1" className={cn(buttonVariants({ size: "sm" }))}>
        <Plus className="h-3.5 w-3.5" />
        Nuevo estudiante
      </Link>
    </div>
  );
}
