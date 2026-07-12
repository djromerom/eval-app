"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { rejectAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      {pending ? "Rechazando…" : "Rechazar"}
    </Button>
  );
}

/** Rechazo con comentario obligatorio (§3.3). */
export function RejectForm({ evaluationId }: { evaluationId: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(rejectAction, {});
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
      <SubmitButton />
    </form>
  );
}
