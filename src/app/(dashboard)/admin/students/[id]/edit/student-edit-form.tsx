"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { ID_TYPES } from "@/modules/students/domain/student";
import { deleteStudentAction, updateStudentAction } from "../../actions";

export interface StudentEditFormProps {
  student: {
    id: string;
    lastName1: string;
    lastName2: string;
    firstName1: string;
    firstName2: string;
    idType: string;
    idNumber: string;
    groupId: string;
    enrollmentYear: number;
    isActive: boolean;
    code: string;
  };
  groupOptions: { value: string; label: string }[];
  returnHref: string;
}

/**
 * Formulario de edición de estudiante (Fase 12).
 *
 * Patrón copy-paste del `PeriodEditForm`:
 * - `updateStudentAction` vía `useActionState` para update.
 * - `deleteStudentAction` con confirmación inline de 2 pasos.
 * - El campo `code` se muestra en el header (read-only). El cambio de código
 *   pasa por `ChangeStudentCode` que preserva el historial (§3.2).
 */
export function StudentEditForm({ student, groupOptions, returnHref }: StudentEditFormProps) {
  const [updateState, updateFormAction] = useActionState<AdminFormState, FormData>(
    updateStudentAction,
    {},
  );
  const [deleteState, deleteFormAction] = useActionState<AdminFormState, FormData>(
    deleteStudentAction,
    {},
  );

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="space-y-6">
      {(updateState.error || deleteState.error) && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {updateState.error || deleteState.error}
        </div>
      )}

      {groupOptions.length === 0 && (
        <div
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          No hay grupos configurados en tu institución.{" "}
          <Link href="/admin/academic" className="underline">
            Crear grupo →
          </Link>
        </div>
      )}

      <form action={updateFormAction} className="space-y-5">
        <input type="hidden" name="studentId" value={student.id} />

        <div className="space-y-1.5">
          <label
            htmlFor="code"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Código estudiantil
          </label>
          <div className="border-input bg-muted/30 text-muted-foreground flex h-10 items-center rounded-md border px-3 font-mono text-sm">
            {student.code}
          </div>
          <p className="text-muted-foreground text-xs">
            El código va embebido en el QR. Cambiarlo requiere un flujo con historial para preservar
            los QR viejos.
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="lastName1"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Apellido 1
          </label>
          <input
            id="lastName1"
            name="lastName1"
            type="text"
            required
            defaultValue={student.lastName1}
            className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="lastName2"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Apellido 2
          </label>
          <input
            id="lastName2"
            name="lastName2"
            type="text"
            defaultValue={student.lastName2}
            className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="firstName1"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Nombre 1
          </label>
          <input
            id="firstName1"
            name="firstName1"
            type="text"
            required
            defaultValue={student.firstName1}
            className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="firstName2"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Nombre 2
          </label>
          <input
            id="firstName2"
            name="firstName2"
            type="text"
            defaultValue={student.firstName2}
            className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="idType"
              className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
            >
              Tipo doc.
            </label>
            <select
              id="idType"
              name="idType"
              required
              defaultValue={student.idType}
              className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            >
              {ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="idNumber"
              className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
            >
              N.º documento
            </label>
            <input
              id="idNumber"
              name="idNumber"
              type="text"
              required
              defaultValue={student.idNumber}
              className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="groupId"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Grupo
          </label>
          <select
            id="groupId"
            name="groupId"
            required
            defaultValue={student.groupId}
            className="border-input focus:ring-primary/30 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          >
            <option value="">—</option>
            {groupOptions.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="enrollmentYear"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Año de ingreso
          </label>
          <input
            id="enrollmentYear"
            name="enrollmentYear"
            type="number"
            min={1990}
            step={1}
            required
            defaultValue={student.enrollmentYear}
            className="border-input focus:ring-primary/30 w-32 rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={student.isActive}
            className="border-input h-4 w-4 rounded"
          />
          <span>Estudiante activo</span>
          <span className="text-muted-foreground text-xs">
            (desmarca para dar de baja sin perder el historial del QR)
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {confirmingDelete ? (
            <form
              action={deleteFormAction}
              onSubmit={() => setConfirmingDelete(false)}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="studentId" value={student.id} />
              <span className="text-destructive text-xs font-medium">
                ¿Eliminar definitivamente?
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmingDelete(false)}
              >
                No
              </Button>
              <Button type="submit" variant="destructive" size="sm">
                Sí, eliminar
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmingDelete(true)}
            >
              Eliminar
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm">
              <Link href={returnHref}>Cancelar</Link>
            </Button>
            <Button type="submit" size="sm">
              Guardar cambios
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
