"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { ID_TYPES } from "@/modules/students/domain/student";
import { importStudentsAction, type ImportState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Importando…" : "Importar XLSX / CSV"}
    </Button>
  );
}

export function ImportForm() {
  const [state, formAction] = useActionState<ImportState, FormData>(importStudentsAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Sube un archivo XLSX o CSV con columnas:{" "}
        <code>
          apellido1, apellido2, nombre1, nombre2, tipo_doc, num_doc, codigo, grupo, anio_ingreso
        </code>
        . Opcionales: <code>grado</code>. Si incluyes <code>tipo_cuadernillo</code> debes traer
        también la columna <code>prueba</code> (Periodo) para identificarlo. Acepta separador{" "}
        <code>,</code> o <code>;</code> en CSV.
      </p>
      <p className="text-muted-foreground text-sm">
        Si el <code>codigo</code> ya existe, el estudiante se actualiza en vez de duplicarse: solo
        se escriben las columnas que trae el archivo y el <code>codigo</code> y el{" "}
        <code>grupo</code> del estudiante no se cambian.
      </p>
      <details className="text-muted-foreground text-sm">
        <summary className="cursor-pointer">Tipos de documento válidos</summary>
        <ul className="mt-2 flex flex-wrap gap-2">
          {ID_TYPES.map((t) => (
            <li key={t} className="bg-muted rounded-md px-2 py-1 font-mono text-xs">
              {t}
            </li>
          ))}
        </ul>
      </details>
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
      <p className="text-muted-foreground text-xs">
        ¿Necesitas una plantilla?{" "}
        <a
          href="/admin/students/template.xlsx"
          download
          className="text-primary underline underline-offset-2"
        >
          Descargar plantilla XLSX
        </a>
        .
      </p>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      {state.done ? (
        <div className="bg-muted/30 space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">
            {state.created} estudiante(s) importado(s), {state.updated} actualizado(s)
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
          {state.warnings && state.warnings.length > 0 ? (
            <>
              <p className="font-medium">{state.warnings.length} fila(s) con avisos:</p>
              <ul className="max-h-40 list-inside list-disc overflow-y-auto text-amber-700 dark:text-amber-400">
                {state.warnings.map((w) => (
                  <li key={w.row}>
                    Fila {w.row}: {w.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
