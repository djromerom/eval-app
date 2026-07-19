"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBundleAction, type BundleFormState } from "../actions";

interface CandidateEvaluation {
  id: string;
  title: string;
  status: string;
  totalQuestions: number;
  courseName: string;
  subjectName: string;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Creando…" : "Crear compendio"}
    </Button>
  );
}

/**
 * Wizard de creación. Step 1: nombre + bookletNumber. Step 2: selección de
 * evaluaciones (checkbox list con búsqueda por título/asignatura). El submit
 * envía un solo FormData al server action createBundleAction con todos los
 * evaluationIds seleccionados.
 */
export function CreateBundleWizard({ evaluations }: { evaluations: CandidateEvaluation[] }) {
  const [state, formAction] = useActionState(createBundleAction, {} as BundleFormState);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Filtro básico (case-insensitive) sobre título, asignatura o curso.
  const filtered = evaluations.filter((e) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      e.title.toLowerCase().includes(q) ||
      e.subjectName.toLowerCase().includes(q) ||
      e.courseName.toLowerCase().includes(q)
    );
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Tras éxito, el server action redirige (redirect()), por lo que no llega aquí.
  // Si llega un error, lo mostramos y no tocamos selected.
  useEffect(() => {
    /* no-op: useActionState maneja el reset vía formRef si quisiéramos */
  }, [state]);

  const totalQuestions = evaluations
    .filter((e) => selected.has(e.id))
    .reduce((acc, e) => acc + e.totalQuestions, 0);

  return (
    <form ref={formRef} action={formAction} className="bg-card space-y-6 rounded-xl border p-6">
      {/* Step 1 — metadatos */}
      <section className="space-y-4">
        <h2 className="font-semibold">1. Datos del compendio</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              Nombre del compendio
            </label>
            <Input
              id="name"
              name="name"
              required
              placeholder="Compendio 11° — I periodo"
              minLength={3}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bookletNumber" className="text-sm font-medium">
              N° de cuadernillo (opcional)
            </label>
            <Input
              id="bookletNumber"
              name="bookletNumber"
              type="number"
              min={1}
              step={1}
              placeholder="1"
            />
          </div>
        </div>
      </section>

      {/* Step 2 — selección de evaluaciones */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-semibold">
            2. Evaluaciones ({selected.size} seleccionada{selected.size === 1 ? "" : "s"})
          </h2>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar…"
            className="max-w-xs"
          />
        </div>

        {evaluations.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            No hay evaluaciones aprobadas o publicadas disponibles para incluir.
          </p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2">
            {filtered.length === 0 ? (
              <li className="text-muted-foreground p-4 text-center text-sm">Sin coincidencias.</li>
            ) : (
              filtered.map((e) => (
                <li key={e.id}>
                  <label className="hover:bg-accent flex cursor-pointer items-start gap-3 rounded-md p-2 text-sm">
                    <input
                      type="checkbox"
                      name="evaluationIds"
                      value={e.id}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{e.title}</div>
                      <div className="text-muted-foreground text-xs">
                        {e.subjectName} · {e.courseName} · {e.totalQuestions} preguntas · {e.status}
                      </div>
                    </div>
                  </label>
                </li>
              ))
            )}
          </ul>
        )}

        {selected.size > 0 ? (
          <p className="text-muted-foreground text-xs">
            Total de preguntas estimado: <strong>{totalQuestions}</strong> (~{" "}
            {Math.ceil((totalQuestions * 2.5) / 60)} h de aplicación a ritmo ICFES).
          </p>
        ) : null}
      </section>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <SubmitButton disabled={selected.size === 0} />
      </div>
    </form>
  );
}
