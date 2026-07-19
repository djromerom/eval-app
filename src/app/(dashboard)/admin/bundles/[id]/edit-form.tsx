"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateBundleAction, type BundleFormState } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Guardando…" : "Guardar cambios"}
    </Button>
  );
}

/**
 * Form de edición de metadatos del compendio (solo DRAFT).
 * Usado en la página de detalle.
 */
export function BundleEditForm({
  bundleId,
  initialName,
  initialBookletNumber,
  initialCourseId,
  courses,
}: {
  bundleId: string;
  initialName: string;
  initialBookletNumber: number | null;
  initialCourseId: string | null;
  courses: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(updateBundleAction, {} as BundleFormState);
  const formRef = useRef<HTMLFormElement>(null);

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

      <div className="space-y-1">
        <label htmlFor="courseId" className="text-sm font-medium">
          Curso
        </label>
        <select
          id="courseId"
          name="courseId"
          defaultValue={initialCourseId ?? ""}
          className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
        >
          <option value="">Sin curso específico (varios grados)</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Para asignar un curso, todas las evaluaciones del compendio deben ser de ese curso.
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
