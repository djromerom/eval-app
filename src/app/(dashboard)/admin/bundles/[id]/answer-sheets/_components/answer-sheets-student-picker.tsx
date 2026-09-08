"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PickerStudent {
  id: string;
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  code: string;
  groupName: string | null;
}

/**
 * Lista de estudiantes con checkboxes + botón "Seleccionar/Deseleccionar
 * todos". Al submit, genera `?students=id1&students=id2...` (array) que el
 * servidor de /print ya normaliza con `normalizeStudentIds`.
 *
 * Antes de tener este cliente component, los checkboxes eran uncontrolled
 * (sin state), lo que impedía implementar la acción "seleccionar todos"
 * sin perder los marcados individuales al re-render.
 */
export function AnswerSheetsStudentPicker({
  bundleId,
  students,
}: {
  bundleId: string;
  students: PickerStudent[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSelected = students.length > 0 && selected.size === students.length;
  const noneSelected = selected.size === 0;
  const someSelected = !allSelected && !noneSelected;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(students.map((s) => s.id)));
    }
  }

  /** Sprint PDF download (sep 2026): el botón hace fetch directo a
   *  `/api/bundles/${id}/answer-sheets/pdf?students=<csv>` y descarga el
   *  blob como `${id}-answer-sheets-bundle.pdf`. Sin diálogo de impresión,
   *  sin HTML intermedio, sin popup.
   *
   *  Antes (sep 2026 sprint "imprimir de una vez"): abría la ruta /print
   *  en popup con `?autoprint=1` y dejaba que el `AutoPrint` de la página
   *  disparara `window.print()`. El admin tenía que pulsar "Guardar como
   *  PDF" en el diálogo del navegador. Ahora: descarga directa. */
  async function handleDownload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (noneSelected || loading) return;
    setError(null);

    const studentsParam = Array.from(selected).join(",");
    const url = `/api/bundles/${bundleId}/answer-sheets/pdf?students=${encodeURIComponent(
      studentsParam,
    )}`;

    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo generar el PDF.");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${bundleId}-answer-sheets-bundle.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleDownload} className="bg-card space-y-4 rounded-xl border p-6">
      {students.length > 0 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {noneSelected
              ? "Ningún estudiante seleccionado"
              : `${selected.size} de ${students.length} seleccionado${
                  selected.size === 1 ? "" : "s"
                }`}
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
          </button>
        </div>
      ) : null}

      <ul className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2">
        {students.length === 0 ? (
          <li className="text-muted-foreground p-4 text-center text-sm">
            No hay estudiantes activos en este grado.
          </li>
        ) : (
          students.map((s) => (
            <li key={s.id}>
              <label className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md p-2 text-sm">
                <input
                  type="checkbox"
                  name="students"
                  value={s.id}
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                  ref={(el) => {
                    // Marca visual "indeterminate" cuando hay selección parcial.
                    if (el) el.indeterminate = someSelected && selected.has(s.id);
                  }}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium">
                    {`${s.lastName1} ${s.lastName2} ${s.firstName1} ${s.firstName2}`
                      .replace(/\s+/g, " ")
                      .trim()}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {s.code} · {s.groupName ?? "Sin grado"}
                  </div>
                </div>
              </label>
            </li>
          ))
        )}
      </ul>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/admin/bundles/${bundleId}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← Volver al cuadernillo
        </Link>
        <button
          type="submit"
          className={cn(buttonVariants({ size: "sm" }))}
          disabled={noneSelected || loading}
        >
          {loading ? "Generando PDF…" : "Descargar PDF"}
        </button>
      </div>
    </form>
  );
}
