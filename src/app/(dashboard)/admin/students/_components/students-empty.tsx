"use client";

import { Sparkles, UserPlus } from "lucide-react";

/**
 * Estado vacío + setup banner de `admin/students` (Fase 12).
 *
 * Se muestra cuando el listado está vacío. Mantiene identidad ecognIA
 * (`bg-brand-mint-tint` para el banner verde menta) y propone dos acciones
 * de alta: importar CSV o crear manualmente el primero.
 */
export function StudentsEmpty({ hasGroups }: { hasGroups: boolean }) {
  return (
    <div role="status" className="bg-brand-mint-tint border-accent rounded-2xl border p-6">
      <div className="flex items-start gap-3">
        <div className="bg-accent/15 text-accent inline-flex h-9 w-9 items-center justify-center rounded-md">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <p className="font-display text-base font-bold">
            Aún no hay estudiantes en tu institución
          </p>
          <p className="text-muted-foreground text-sm">
            Empieza importando tu primera lista desde un CSV, o crea un estudiante manualmente.{" "}
            {hasGroups
              ? ""
              : "Primero necesitas configurar al menos un grupo en Estructura académica."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="?import=1"
            className="border-accent/50 text-accent hover:bg-accent/10 inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-xs font-bold"
          >
            Importar CSV
          </a>
          <a
            href="?new=1"
            className="bg-accent text-accent-foreground hover:bg-accent/90 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Crear manualmente
          </a>
        </div>
      </div>
    </div>
  );
}
