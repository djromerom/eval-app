"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

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

  /** Sprint PDF download (sep 2026): el botón ahora abre la ruta
   *  `/print/answer-sheets/bundle/${id}?autoprint=1&students=...` en una
   *  ventana popup. La propia página de impresión trae un componente cliente
   *  (`AutoPrint`) que detecta `?autoprint=1` y dispara `window.print()`
   *  desde DENTRO de la popup. El diálogo del navegador ofrece "Guardar
   *  como PDF" como destino, así el docente obtiene un PDF real sin pasar
   *  por la cola asíncrona del worker PDF (puppeteer+BullMQ). Tras guardar
   *  y cerrar el diálogo, el admin cierra la popup manualmente y
   *  `router.back()` le devuelve al cuadernillo.
   *
   *  Por qué `?autoprint=1` desde dentro y no `popup.print()` desde el
   *  padre: Chrome bloquea `popup.print()` invocado desde la opener por
   *  políticas anti-popup. Solo permite `print()` cuando lo llama la propia
   *  popup en respuesta al gesto del usuario.
   *
   *  Por qué no descargar el HTML como `.pdf` directamente: el browser
   *  intenta parsearlo como PDF y falla ("Failed to load PDF document")
   *  porque el contenido es HTML imprimible, no un PDF generado. */
  function handleDownload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (noneSelected) return;

    const params = new URLSearchParams();
    for (const id of selected) params.append("students", id);
    params.set("autoprint", "1");
    const url = `/print/answer-sheets/bundle/${bundleId}?${params.toString()}`;

    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) {
      // Popup bloqueado por el navegador → fallback: abrimos en la misma
      // pestaña para que el admin pueda disparar Ctrl/Cmd+P manualmente.
      window.location.href = url;
      return;
    }

    // Cuando la popup se cierre (después de guardar el PDF y cerrarla),
    // volvemos al cuadernillo del que vinimos.
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        router.back();
      }
    }, 500);
  }

  return (
    <form
      // Sin `action` ni `target` — el submit se intercepta en `handleDownload`
      // para disparar la descarga vía anchor programático + `router.back()`.
      onSubmit={handleDownload}
      className="bg-card space-y-4 rounded-xl border p-6"
    >
      <input type="hidden" name="t" value="" disabled />
      {/* El token HMAC no se puede pre-firmar desde el cliente (secreto en
          servidor); el flujo real es via API+worker. Este form queda como
          fallback para previsualización rápida: */}
      <p className="text-muted-foreground text-xs">
        Previsualiza o imprime directamente desde el navegador (sin pasar por el worker PDF).
      </p>

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
          disabled={noneSelected}
        >
          Descargar PDF
        </button>
      </div>
    </form>
  );
}
