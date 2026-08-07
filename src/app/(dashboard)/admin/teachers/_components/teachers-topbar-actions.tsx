"use client";

import { FileUp, Plus } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botones del topbar de `admin/teachers`. El CTA "Importar XLSX/CSV" empuja
 * a la misma ruta con `?import=teachers=1` para abrir el drawer; el de alta
 * individual lo hace con `?new=teacher`.
 *
 * Mantenemos `<Link>` para preservar back/forward y que el redirect del
 * server action limpie el query.
 */
export function TeachersTopbarActions() {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="?import=teachers=1"
        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      >
        <FileUp className="h-3.5 w-3.5" />
        Importar XLSX/CSV
      </Link>
      <Link href="?new=teacher" className={cn(buttonVariants({ size: "sm" }))}>
        <Plus className="h-3.5 w-3.5" />
        Nuevo docente
      </Link>
    </div>
  );
}
