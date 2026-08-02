"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Estado devuelto por las server actions de alta del admin. */
export interface AdminFormState {
  error?: string;
  success?: boolean;
  /** Algunas acciones (ej. addSectionAction) lo devuelven para que el
   *  cliente pueda referenciar la entidad recién creada sin un round-trip
   *  extra (p.ej. el editor unificado lo usa para asignar la pregunta a
   *  la sección recién creada en el mismo click). */
  sectionId?: string;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  placeholder?: string;
  required?: boolean;
  options?: FieldOption[];
  /** Solo aplica cuando type === "number". Se pasa como `min` al <input>. */
  min?: number;
  /** Solo aplica cuando type === "number". Se pasa como `max` al <input>. */
  max?: number;
  /** Texto de ayuda debajo del label (e.g. "Si lo dejas vacío, se calcula
   *  automáticamente con preguntas × 2.5 min"). No rompe layout: se
   *  renderiza en una línea aparte. */
  helpText?: string;
}

type Action = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : label}
    </Button>
  );
}

/** Formulario de alta genérico basado en configuración de campos. */
export function EntityForm({
  action,
  fields,
  submitLabel,
  disabledReason,
}: {
  action: Action;
  fields: Field[];
  submitLabel: string;
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  if (disabledReason) {
    return <p className="text-muted-foreground text-sm">{disabledReason}</p>;
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          <label htmlFor={field.name} className="text-muted-foreground block text-xs font-medium">
            {field.label}
          </label>
          {field.type === "select" ? (
            <select
              id={field.name}
              name={field.name}
              required={field.required}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
            >
              <option value="">—</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : field.type === "checkbox" ? (
            <input
              id={field.name}
              name={field.name}
              type="checkbox"
              className="accent-primary h-9 w-5"
            />
          ) : (
            <Input
              id={field.name}
              name={field.name}
              type={field.type}
              required={field.required}
              placeholder={field.placeholder}
              min={field.type === "number" ? field.min : undefined}
              max={field.type === "number" ? field.max : undefined}
              className="w-40"
            />
          )}
          {field.helpText ? (
            <p className="text-muted-foreground text-xs">{field.helpText}</p>
          ) : null}
        </div>
      ))}
      <SubmitButton label={submitLabel} />
      {state.error ? <p className="text-destructive w-full text-sm">{state.error}</p> : null}
    </form>
  );
}
