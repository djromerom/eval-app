"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TEACHER_ID_TYPES } from "@/modules/teachers/domain/teacher";
import { completeTeacherProfileAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : "Completar"}
    </Button>
  );
}

export function CompleteProfileForm({ teacherId }: { teacherId: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    completeTeacherProfileAction,
    {},
  );
  return (
    <form action={formAction} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="teacherId" value={teacherId} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="idType"
          required
          defaultValue="C.C."
          className="border-input bg-background h-9 rounded-md border px-2 text-sm"
        >
          {TEACHER_ID_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Input name="idNumber" required placeholder="N.º documento" className="h-9 w-36" />
        <Input name="phone" placeholder="Teléfono" className="h-9 w-36" />
        <SubmitButton />
      </div>
      {state.error ? <span className="text-destructive text-xs">{state.error}</span> : null}
      {state.success ? (
        <span className="text-muted-foreground text-xs">Perfil completado ✓</span>
      ) : null}
    </form>
  );
}
