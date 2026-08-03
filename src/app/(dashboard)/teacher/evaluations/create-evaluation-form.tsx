"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { Field } from "@/components/admin/entity-form";

interface BookletTypeRow {
  id: string;
  name: string;
  periodId: string;
}

type Action = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

/**
 * Wrapper client sobre `EntityForm` para crear formulaciones.
 *
 * Necesita ser client porque el select "Tipo de cuadernillo" se filtra
 * según la Prueba seleccionada en el propio form (ago 2026). El server
 * carga TODOS los BookletTypes de la institución una sola vez (tabla
 * chica, decenas de filas); el filtrado es client-side por `periodId`.
 *
 * Si la Prueba seleccionada no tiene tipos configurados, el select queda
 * disabled con hint (UX: el docente sabe que tiene que pedirle al admin
 * que agregue tipos antes de poder elegir uno).
 *
 * Renderizamos un <form action={formAction}> propio (no usamos
 * EntityForm) porque necesitamos manejar el estado de los dos selects
 * dependientes entre sí.
 */
export function CreateEvaluationForm({
  action,
  fields,
  submitLabel,
  disabledReason,
  bookletTypes,
}: {
  action: Action;
  fields: Field[];
  submitLabel: string;
  disabledReason?: string;
  bookletTypes: BookletTypeRow[];
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Mantenemos el estado de los dos selects que dependen entre sí.
  const [periodId, setPeriodId] = useState("");
  const [bookletTypeId, setBookletTypeId] = useState("");

  // Filtramos los BookletTypes disponibles para la Prueba seleccionada.
  // Si no hay Prueba, no mostramos nada.
  const filteredTypes = useMemo(
    () => (periodId ? bookletTypes.filter((bt) => bt.periodId === periodId) : []),
    [periodId, bookletTypes],
  );

  // Cuando cambia el periodo, limpiamos el bookletTypeId (no debe quedar
  // un id que ya no está disponible).
  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPeriodId(e.target.value);
    setBookletTypeId("");
  };

  // Reseteo del form tras éxito (mismo patrón que EntityForm).
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setPeriodId("");
      setBookletTypeId("");
    }
  }, [state.success]);

  if (disabledReason) {
    return <p className="text-muted-foreground text-sm">{disabledReason}</p>;
  }

  const periodField = fields.find((f) => f.name === "periodId");
  const csField = fields.find((f) => f.name === "courseSubjectId");

  if (!periodField || !csField) {
    // Fallback: si por error no encontramos los campos esperados, no
    // renderizamos nada (la página padre controla el flow).
    return null;
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <FieldBlock label={csField.label} required={csField.required}>
        <select
          id={csField.name}
          name={csField.name}
          required={csField.required}
          className={selectClass}
        >
          <option value="">—</option>
          {csField.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldBlock>

      <FieldBlock label={periodField.label} required={periodField.required}>
        <select
          id={periodField.name}
          name={periodField.name}
          required={periodField.required}
          className={selectClass}
          value={periodId}
          onChange={handlePeriodChange}
        >
          <option value="">—</option>
          {periodField.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldBlock>

      <FieldBlock label="Tipo de cuadernillo">
        <select
          id="bookletTypeId"
          name="bookletTypeId"
          className={selectClass}
          value={bookletTypeId}
          onChange={(e) => setBookletTypeId(e.target.value)}
          disabled={!periodId || filteredTypes.length === 0}
        >
          <option value="">—</option>
          {filteredTypes.map((bt) => (
            <option key={bt.id} value={bt.id}>
              {bt.name}
            </option>
          ))}
        </select>
        {periodId && filteredTypes.length === 0 && (
          <p className="text-muted-foreground text-xs">
            Pídale al admin que configure tipos para esta prueba.
          </p>
        )}
      </FieldBlock>

      <SubmitButton label={submitLabel} />
      {state.error ? (
        <p className="text-destructive w-full text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function FieldBlock({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground block text-xs font-medium">
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </label>
      {children}
    </div>
  );
}

/** Botón de submit con estado pending vía useFormStatus. */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : label}
    </Button>
  );
}
