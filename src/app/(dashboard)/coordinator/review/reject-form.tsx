"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { rejectAction } from "./actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Rechazo con comentario obligatorio (§3.3).
 *  Sprint ago 2026: el líder también usa este formulario para revertir una
 *  formulación `APPROVED → DRAFT` (rechazo tardío). El copy del botón se
 *  parametriza para que el page.tsx pueda reusar el componente con el
 *  label "Volver a borrador" sin duplicar markup.
 *
 *  Sprint 2026-08-30: agrega prop `successMessage` para disparar un toast
 *  de confirmación al terminar OK (mismo patrón que `review-action-button.tsx`,
 *  pero este formulario usa `useActionState` para soportar el textarea de
 *  comentario obligatorio). */
export function RejectForm({
  evaluationId,
  label = "Rechazar",
  pendingLabel = "Rechazando…",
  successMessage = "Formulación rechazada",
}: {
  evaluationId: string;
  label?: string;
  pendingLabel?: string;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(rejectAction, {});

  // Toast de confirmación al terminar OK. El ref evita doble-disparo por
  // Strict Mode (dev) comparando la referencia del state nuevo con el
  // último para el que ya disparamos el toast.
  const lastFiredState = useRef<AdminFormState | null>(null);
  useEffect(() => {
    if (state.success && state !== lastFiredState.current) {
      lastFiredState.current = state;
      toast.success(successMessage);
    }
  }, [state, successMessage]);

  return (
    <form action={formAction} className="flex items-start gap-2">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <div className="space-y-1">
        <input
          name="comment"
          required
          placeholder="Motivo del rechazo…"
          className="border-input bg-background focus-visible:ring-ring h-9 w-56 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
        />
        {state.error ? <p className="text-destructive text-xs">{state.error}</p> : null}
      </div>
      <SubmitButton label={label} pendingLabel={pendingLabel} />
    </form>
  );
}
