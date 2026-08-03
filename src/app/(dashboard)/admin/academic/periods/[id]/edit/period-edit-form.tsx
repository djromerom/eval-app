"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { deletePeriodAction, updatePeriodAction } from "../../../actions";
import { setCurrentPeriodAction } from "./actions";

export interface PeriodEditFormProps {
  period: {
    id: string;
    name: string;
    order: number;
    startDate: string; // yyyy-mm-dd ya formateado
    endDate: string;
    academicYearId: string;
    academicYearLabel: string;
    /** Si la prueba ya está marcada como "actual" en su año académico
     *  (ago 2026). El toggle del drawer parte de aquí. */
    isCurrent: boolean;
  };
  /** Nombres de los demás periodos del mismo año — para detectar conflictos
   *  de uniqueness y mostrar el banner amarillo. */
  siblingNames: string[];
}

const dateToInput = (s: string): string => {
  // Acepta "12 mar 2026" (formato es-CO) o "2026-03-12". Devuelve yyyy-mm-dd
  // para <input type="date">.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

export function PeriodEditForm({ period, siblingNames }: PeriodEditFormProps) {
  const [updateState, updateFormAction] = useActionState(updatePeriodAction, {});
  const [deleteState, deleteFormAction] = useActionState(deletePeriodAction, {});
  const [setCurrentState, setCurrentFormAction] = useActionState(setCurrentPeriodAction, {});

  const [name, setName] = useState(period.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const trimmed = name.trim();
  const conflictName = !!trimmed && siblingNames.some((s) => s.trim() === trimmed);

  return (
    <div className="space-y-6">
      {/* Error general de update / delete (validación, conflict, etc.) */}
      {(updateState.error || deleteState.error) && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {updateState.error || deleteState.error}
        </div>
      )}

      {/* Banner amarillo de conflicto prevenido — UX: ofrece atajo al periodo
          existente con el mismo nombre en lugar de forzar a corregirlo. */}
      {conflictName && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <strong className="font-semibold">Detectamos un conflicto.</strong> Ya existe un periodo
          llamado &ldquo;{trimmed}&rdquo; en este año académico. Elige otro nombre o edita el
          periodo existente.
        </div>
      )}

      <form action={updateFormAction} className="space-y-5">
        <input type="hidden" name="periodId" value={period.id} />

        {/* Año académico — read-only en el drawer. El periodo no se mueve
            de año desde aquí; si hace falta, bórralo y créalo en el año destino. */}
        <div className="space-y-1.5">
          <label
            htmlFor="academicYear"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Año académico
          </label>
          <div className="border-input bg-muted/30 text-muted-foreground flex h-10 items-center rounded-md border px-3 text-sm">
            {period.academicYearLabel}
          </div>
          <p className="text-muted-foreground text-xs">
            El año no se puede cambiar desde aquí. Bórralo y créalo de nuevo si necesitas moverlo.
          </p>
        </div>

        {/* Nombre — con border rojo si hay conflicto. */}
        <div className="space-y-1.5">
          <label
            htmlFor="name"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Nombre de la prueba
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={
              conflictName
                ? "border-destructive focus:ring-destructive/30 w-full rounded-md border-2 bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                : "border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            }
            placeholder="Ej. I Prueba, II Prueba…"
          />
          {conflictName && (
            <p className="text-destructive text-xs">
              Ya existe una prueba llamada &ldquo;{trimmed}&rdquo; en este año académico.
            </p>
          )}
        </div>

        {/* Orden */}
        <div className="space-y-1.5">
          <label
            htmlFor="order"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Orden
          </label>
          <input
            id="order"
            name="order"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={period.order}
            className="border-input focus:ring-primary/30 w-32 rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
          <p className="text-muted-foreground text-xs">
            Entero positivo. Se usa para ordenar los periodos de menor a mayor.
          </p>
        </div>

        {/* Inicio + Fin en la misma fila. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="startDate"
              className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
            >
              Inicio
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              defaultValue={dateToInput(period.startDate)}
              className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="endDate"
              className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
            >
              Fin
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              defaultValue={dateToInput(period.endDate)}
              className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
        </div>

        {/* Marcación como prueba actual (ago 2026). */}
        <div className="bg-muted/30 rounded-lg border p-3">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Prueba actual
          </p>
          {period.isCurrent ? (
            <>
              <p className="mt-1 text-sm">
                Esta prueba está marcada como <strong>actual</strong> en su año académico. Al crear
                formulaciones, los docentes la verán preseleccionada y no podrán cambiarla.
              </p>
              <form action={setCurrentFormAction} className="mt-2">
                <input type="hidden" name="periodId" value={period.id} />
                <input type="hidden" name="isCurrent" value="false" />
                <Button type="submit" variant="outline" size="sm">
                  Quitar marcación
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm">
                Al marcarla como <strong>actual</strong>, esta prueba se preselecciona al crear
                formulaciones y bloquea la elección de otras pruebas del mismo año académico.
              </p>
              <form action={setCurrentFormAction} className="mt-2">
                <input type="hidden" name="periodId" value={period.id} />
                <input type="hidden" name="isCurrent" value="true" />
                <Button type="submit" size="sm">
                  Marcar como actual
                </Button>
              </form>
            </>
          )}
          {setCurrentState.error && (
            <p className="text-destructive mt-2 text-xs" role="alert">
              {setCurrentState.error}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {/* Botón destructivo con confirmación inline (no global window.confirm). */}
          {confirmingDelete ? (
            <form
              action={deleteFormAction}
              onSubmit={() => {
                // Reset después del submit exitoso (en caso de error el state
                // cambia y la página rerendera). En éxito redirige y no importa.
                setConfirmingDelete(false);
              }}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="periodId" value={period.id} />
              <span className="text-destructive text-xs font-medium">
                ¿Eliminar definitivamente?
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDelete(false)}
              >
                No
              </Button>
              <Button type="submit" variant="destructive" size="sm">
                Sí, eliminar
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
            >
              Eliminar
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm">
              <a href="/admin/academic">Cancelar</a>
            </Button>
            <Button type="submit" size="sm" disabled={conflictName}>
              Guardar cambios
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
