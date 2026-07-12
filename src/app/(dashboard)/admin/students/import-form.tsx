"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { importStudentsAction, type ImportState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Importando…" : "Importar CSV"}
    </Button>
  );
}

export function ImportForm() {
  const [state, formAction] = useActionState<ImportState, FormData>(importStudentsAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Sube un CSV con columnas:{" "}
        <code>nombre, tipo_doc, num_doc, codigo, grupo, anio_ingreso</code>. Acepta separador{" "}
        <code>,</code> o <code>;</code>.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="file:border-input file:bg-background text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
        />
        <SubmitButton />
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      {state.done ? (
        <div className="bg-muted/30 space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">
            {state.created} estudiante(s) importado(s)
            {state.errors && state.errors.length > 0
              ? `, ${state.errors.length} fila(s) con errores:`
              : "."}
          </p>
          {state.errors && state.errors.length > 0 ? (
            <ul className="text-destructive max-h-40 list-inside list-disc overflow-y-auto">
              {state.errors.map((e) => (
                <li key={e.row}>
                  Fila {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
