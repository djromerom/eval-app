"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createInstitutionAction, type CreateInstitutionState } from "./actions";

const initialState: CreateInstitutionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creando…" : "Crear institución"}
    </Button>
  );
}

export function CreateInstitutionForm() {
  const [state, formAction] = useActionState(createInstitutionAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  // Limpia el formulario tras un alta exitosa.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="bg-card space-y-4 rounded-xl border p-6">
      <h2 className="font-semibold">Nueva institución</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium">
            Nombre
          </label>
          <Input id="name" name="name" required placeholder="I.E. Ejemplo" />
        </div>
        <div className="space-y-1">
          <label htmlFor="slug" className="text-sm font-medium">
            Slug (subdominio)
          </label>
          <Input id="slug" name="slug" required placeholder="ie-ejemplo" />
        </div>
        <div className="space-y-1">
          <label htmlFor="code" className="text-sm font-medium">
            Código
          </label>
          <Input id="code" name="code" required placeholder="IEE01" />
        </div>
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? <p className="text-muted-foreground text-sm">Institución creada.</p> : null}

      <SubmitButton />
    </form>
  );
}
