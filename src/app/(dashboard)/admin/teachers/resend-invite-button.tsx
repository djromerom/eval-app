"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { resendTeacherInvitationAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Enviando…" : "Reenviar invitación"}
    </Button>
  );
}

export function ResendInviteButton({ teacherId }: { teacherId: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    resendTeacherInvitationAction,
    {},
  );
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="teacherId" value={teacherId} />
      <SubmitButton />
      {state.error ? <span className="text-destructive text-xs">{state.error}</span> : null}
      {state.success ? (
        <span className="text-muted-foreground text-xs">Invitación enviada ✓</span>
      ) : null}
    </form>
  );
}
