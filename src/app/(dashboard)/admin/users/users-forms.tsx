"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { Role } from "@/shared/application/authenticated-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteUserAction, setUserRolesAction, type UserFormState } from "./actions";
import { ROLE_OPTIONS } from "./roles";

function RoleCheckboxes({ selected }: { selected?: Role[] }) {
  const set = new Set(selected ?? []);
  return (
    <div className="flex flex-wrap gap-3">
      {ROLE_OPTIONS.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            name="roles"
            value={opt.value}
            defaultChecked={set.has(opt.value)}
            className="accent-primary"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function SubmitButton({ label, size = "default" }: { label: string; size?: "default" | "sm" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} disabled={pending}>
      {pending ? "Guardando…" : label}
    </Button>
  );
}

export function InviteUserForm({
  /** Lista de instituciones para el selector. Si NO se pasa, el form se
   *  renderiza sin selector — el usuario se invita a la institución del
   *  actor implícitamente. Solo se pasa cuando el actor es SUPER_ADMIN y
   *  queremos permitir cross-institución desde esta pantalla. */
  institutions,
}: {
  institutions?: Array<{ id: string; name: string }>;
} = {}) {
  const [state, formAction] = useActionState<UserFormState, FormData>(inviteUserAction, {});
  const showInstitutionPicker = !!institutions && institutions.length > 0;
  return (
    <form action={formAction} className="bg-card space-y-4 rounded-xl border p-6">
      <h2 className="font-semibold">Invitar usuario</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="name" className="text-sm font-medium">
            Nombre
          </label>
          <Input id="name" name="name" required placeholder="Nombre y apellido" />
        </div>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo electrónico
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="docente@colegio.edu.co"
          />
        </div>
      </div>
      {showInstitutionPicker ? (
        <div className="space-y-1">
          <label htmlFor="targetInstitutionId" className="text-sm font-medium">
            Institución
          </label>
          <select
            id="targetInstitutionId"
            name="targetInstitutionId"
            required
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            {institutions!.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {inst.name}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            Como SUPER_ADMIN puedes invitar usuarios a cualquier institución.
          </p>
        </div>
      ) : null}
      <div className="space-y-1">
        <span className="text-sm font-medium">Roles</span>
        <RoleCheckboxes />
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? (
        <p className="text-muted-foreground text-sm">
          Usuario invitado (queda inactivo hasta que ingrese).
        </p>
      ) : null}
      <SubmitButton label="Enviar invitación" />
    </form>
  );
}

export function RolesEditor({ userId, roles }: { userId: string; roles: Role[] }) {
  const [state, formAction] = useActionState<UserFormState, FormData>(setUserRolesAction, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="userId" value={userId} />
      <RoleCheckboxes selected={roles} />
      <SubmitButton label="Guardar roles" size="sm" />
      {state.error ? <span className="text-destructive text-sm">{state.error}</span> : null}
    </form>
  );
}
