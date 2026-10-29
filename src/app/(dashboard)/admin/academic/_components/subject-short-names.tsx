"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHORT_NAME_MAX } from "@/modules/academic/domain/types";
import { updateSubjectShortNameAction, type FormState } from "../actions";

interface SubjectRow {
  id: string;
  name: string;
  code: string;
  shortName: string | null;
  /** Del catálogo global (institutionId null). */
  global: boolean;
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending || disabled}>
      {pending ? "Guardando…" : "Guardar"}
    </Button>
  );
}

function SubjectShortNameRow({ subject, editable }: { subject: SubjectRow; editable: boolean }) {
  const [state, formAction] = useActionState(updateSubjectShortNameAction, {} as FormState);
  // "Guardado." solo mientras el valor visible es el guardado: al volver a
  // escribir en la fila, el mensaje se oculta hasta el siguiente envío.
  const [editado, setEditado] = useState(false);
  useEffect(() => setEditado(false), [state]);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{subject.name}</p>
        <p className="text-muted-foreground text-xs">{subject.code}</p>
      </div>
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="subjectId" value={subject.id} />
        <label className="sr-only" htmlFor={`sigla-${subject.id}`}>
          Sigla de {subject.name}
        </label>
        <Input
          id={`sigla-${subject.id}`}
          name="shortName"
          defaultValue={subject.shortName ?? ""}
          placeholder={subject.name}
          maxLength={SHORT_NAME_MAX}
          onChange={() => setEditado(true)}
          disabled={!editable}
          title={editable ? undefined : "Asignatura global: solo la edita un SUPER_ADMIN."}
          className="h-8 w-36"
        />
        <SaveButton disabled={!editable} />
      </form>
      {state.error ? (
        <p className="text-destructive w-full text-xs" role="alert">
          {state.error}
        </p>
      ) : state.success && !editado ? (
        <p className="text-muted-foreground w-full text-xs" role="status">
          Guardado.
        </p>
      ) : null}
    </li>
  );
}

/**
 * Siglas de las asignaturas, que usan los encabezados de los informes (p. ej.
 * el Informe detallado por grupo de Consultas). Sin sigla, el informe muestra
 * el nombre completo. Las asignaturas del catálogo global solo las edita un
 * SUPER_ADMIN: la sigla es una sola y la ven todas las instituciones.
 */
export function SubjectShortNames({
  subjects,
  canEditGlobal,
}: {
  subjects: SubjectRow[];
  canEditGlobal: boolean;
}) {
  if (subjects.length === 0) return null;
  return (
    <div className="space-y-1 border-t pt-3">
      <h4 className="text-sm font-medium">Sigla en informes</h4>
      <p className="text-muted-foreground text-xs">
        Se usa en los encabezados de los informes. Si está vacía se muestra el nombre completo.
      </p>
      <ul className="divide-y text-sm">
        {subjects.map((s) => (
          <SubjectShortNameRow key={s.id} subject={s} editable={!s.global || canEditGlobal} />
        ))}
      </ul>
    </div>
  );
}
