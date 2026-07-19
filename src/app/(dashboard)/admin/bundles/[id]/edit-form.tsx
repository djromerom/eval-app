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
}: {
  bundleId: string;
  initialName: string;
  initialBookletNumber: number | null;
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

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? <p className="text-muted-foreground text-sm">Cambios guardados.</p> : null}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}
