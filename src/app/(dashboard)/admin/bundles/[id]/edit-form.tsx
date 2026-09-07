"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateBundleAction, type BundleFormState } from "../actions";

interface PeriodOption {
  id: string;
  name: string;
}

interface BookletTypeOption {
  id: string;
  periodId: string;
  name: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Guardando…" : "Guardar cambios"}
    </Button>
  );
}

/**
 * Form de edición de metadatos del cuadernillo (solo DRAFT).
 * Usado en la página de detalle.
 *
 * Sprint Bundle-Period (sep 2026): añade selects de Prueba y Tipo de
 * cuadernillo con cascada Period → BookletType. "" en Prueba o Tipo =
 * limpiar el campo (el use case trata `null` como "limpiar").
 */
export function BundleEditForm({
  bundleId,
  initialName,
  initialBookletNumber,
  initialCourseId,
  initialPeriodId,
  initialBookletTypeId,
  courses,
  periods,
  bookletTypes,
}: {
  bundleId: string;
  initialName: string;
  initialBookletNumber: number | null;
  initialCourseId: string | null;
  initialPeriodId: string | null;
  initialBookletTypeId: string | null;
  courses: Array<{ id: string; name: string }>;
  periods: PeriodOption[];
  bookletTypes: BookletTypeOption[];
}) {
  const [state, formAction] = useActionState(updateBundleAction, {} as BundleFormState);
  const formRef = useRef<HTMLFormElement>(null);

  // Estado controlado de los selects (necesario para la cascada).
  const [periodId, setPeriodId] = useState<string>(initialPeriodId ?? "");
  const [bookletTypeId, setBookletTypeId] = useState<string>(initialBookletTypeId ?? "");

  // BookletTypes disponibles para la Prueba seleccionada. Si periodId es ""
  // (sin Prueba), mostramos todos para que el admin pueda asignar Tipo antes
  // de elegir Prueba (caso defensivo).
  const filteredTypes = useMemo(() => {
    if (!periodId) return bookletTypes;
    return bookletTypes.filter((bt) => bt.periodId === periodId);
  }, [periodId, bookletTypes]);

  // Si cambia la Prueba seleccionada, descartamos el Tipo seleccionado si ya
  // no es válido en el nuevo Period.
  useEffect(() => {
    if (!periodId) {
      if (bookletTypeId) setBookletTypeId("");
      return;
    }
    if (bookletTypeId && !filteredTypes.find((bt) => bt.id === bookletTypeId)) {
      setBookletTypeId("");
    }
  }, [periodId, filteredTypes, bookletTypeId]);

  useEffect(() => {
    if (state.success) {
      // No reset: queremos mantener los valores actuales visibles.
    }
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="bg-card space-y-4 rounded-xl border p-6">
      <h2 className="font-semibold">Metadatos</h2>
      <input type="hidden" name="id" value={bundleId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium">
            Nombre
          </label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={initialName}
            minLength={3}
            maxLength={120}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bookletNumber" className="text-sm font-medium">
            N° de cuadernillo
          </label>
          <Input
            id="bookletNumber"
            name="bookletNumber"
            type="number"
            min={1}
            step={1}
            defaultValue={initialBookletNumber ?? ""}
            placeholder="Opcional"
          />
        </div>
      </div>

      {/* Sprint Bundle-Period: Prueba + Tipo de cuadernillo */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="periodId" className="text-sm font-medium">
            Prueba
          </label>
          <select
            id="periodId"
            name="periodId"
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            <option value="">Sin Prueba</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="bookletTypeId" className="text-sm font-medium">
            Tipo de cuadernillo
          </label>
          <select
            id="bookletTypeId"
            name="bookletTypeId"
            value={bookletTypeId}
            onChange={(e) => setBookletTypeId(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            <option value="">Sin tipo</option>
            {filteredTypes.map((bt) => (
              <option key={bt.id} value={bt.id}>
                {bt.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="courseId" className="text-sm font-medium">
          Grado
        </label>
        <select
          id="courseId"
          name="courseId"
          defaultValue={initialCourseId ?? ""}
          className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
        >
          <option value="">Sin grado específico (varios grados)</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Para asignar un grado, todas las formulaciones del cuadernillo deben ser de ese grado.
        </p>
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? <p className="text-muted-foreground text-sm">Cambios guardados.</p> : null}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
