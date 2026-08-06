"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { importTeachersAction, type TeachersImportState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Importando…" : "Importar"}
    </Button>
  );
}

export function TeachersImportForm() {
  const [state, formAction] = useActionState<TeachersImportState, FormData>(
    importTeachersAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Sube un archivo XLSX o CSV con columnas:{" "}
        <code>nombre, correo, tipodoc, numdoc, telefono</code>. Acepta sinónimos (Name, Correo
        electrónico, Tipo documento, Número documento, Celular). Separador coma o punto y coma.
      </p>
      <div className="flex items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          required
          className="file:border-input file:bg-background text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
        />
        <SubmitButton />
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      {state.done ? (
        <div className="bg-muted/30 space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">
            {state.created} docente(s) creado(s)
            {(state.failed ?? 0) > 0 ? `, ${state.failed} fila(s) con errores:` : "."}
          </p>
          {state.errors && state.errors.length > 0 ? (
            <ul className="text-destructive max-h-40 list-inside list-disc overflow-y-auto">
              {state.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  Fila {e.row}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <a
        href="/admin/teachers/template"
        download
        className="text-muted-foreground text-xs underline"
      >
        Descargar plantilla (.csv)
      </a>
    </form>
  );
}
