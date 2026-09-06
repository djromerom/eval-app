"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { setCurrentAcademicYearAction, type ActionResult } from "./action";

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? "Marcando…" : "Marcar como actual"}
    </Button>
  );
}

export interface SetCurrentAcademicYearFormProps {
  academicYearId: string;
  /** El año ya está marcado como actual — deshabilita el botón y avisa. */
  alreadyCurrent: boolean;
}

/**
 * Form simple que confirma el cambio de año académico "actual". Patrón
 * replica `period-edit-form.tsx:233-289` (que tiene el toggle `isCurrent`
 * inline en el drawer del periodo).
 *
 * UX: si ya es el año actual, se muestra un mensaje informativo y se
 * deshabilita el botón. Si no, se confirma con un POST al server action
 * y se navega de vuelta al overview de academic.
 */
export function SetCurrentAcademicYearForm({
  academicYearId,
  alreadyCurrent,
}: SetCurrentAcademicYearFormProps) {
  const [state, formAction] = useActionState<ActionResult, FormData>(
    setCurrentAcademicYearAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="academicYearId" value={academicYearId} />

      {alreadyCurrent ? (
        <p className="bg-primary/10 text-primary rounded-md p-3 text-sm">
          Este año ya está marcado como actual.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Al marcar este año como actual, se desmarcará cualquier otro año académico de la
          institución y las próximas importaciones de estudiantes se asignarán a este año.
        </p>
      )}

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/academic">Cancelar</Link>
        </Button>
        <SubmitButton disabled={alreadyCurrent} />
      </div>
    </form>
  );
}
