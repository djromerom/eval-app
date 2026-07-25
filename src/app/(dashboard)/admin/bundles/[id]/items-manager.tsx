"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { addItemAction, moveItemAction, removeItemAction, type ItemsFormState } from "./actions";

interface ItemRow {
  id: string;
  order: number;
  evaluationId: string;
  evaluationTitle: string;
  evaluationStatus: string;
  totalQuestions: number;
  subjectName: string | null;
  parentSubjectName: string | null;
}

interface Candidate {
  id: string;
  title: string;
  subjectName: string;
  courseName: string;
  totalQuestions: number;
}

function AddSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? "Añadiendo…" : "Añadir"}
    </Button>
  );
}

/**
 * Gestor de items del cuadernillo (solo editable en DRAFT):
 *   - Lista los items con su orden, título, área y total de preguntas.
 *   - Botones ↑/↓ para mover una posición (server action moveItemAction).
 *   - Botón × para quitar (server action removeItemAction).
 *   - Form de selección para añadir nuevas formulaciones (server action addItemAction).
 */
export function ItemsManager({
  bundleId,
  items,
  candidates,
  isDraft,
}: {
  bundleId: string;
  items: ItemRow[];
  candidates: Candidate[];
  isDraft: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.id ?? "");
  const [addState, addFormAction] = useActionState(addItemAction, {} as ItemsFormState);

  return (
    <div className="bg-card space-y-4 rounded-xl border p-6">
      <div className="flex items-end justify-between gap-2">
        <h2 className="font-semibold">Formulaciones incluidas ({items.length})</h2>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Aún no agregaste formulaciones.
        </p>
      ) : (
        <ol className="space-y-1">
          {items.map((it, idx) => (
            <li key={it.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground w-6 text-right font-mono text-xs">
                {it.order}.
              </span>
              <div className="flex-1">
                <div className="font-medium">{it.evaluationTitle}</div>
                <div className="text-muted-foreground text-xs">
                  {it.parentSubjectName ? `${it.parentSubjectName} · ` : ""}
                  {it.subjectName ?? ""} · {it.totalQuestions} preguntas · {it.evaluationStatus}
                </div>
              </div>

              {isDraft ? (
                <div className="flex items-center gap-1">
                  <form action={moveItemAction}>
                    <input type="hidden" name="bundleId" value={bundleId} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <input type="hidden" name="direction" value="-1" />
                    <button
                      type="submit"
                      disabled={idx === 0}
                      className="hover:bg-accent rounded-md px-2 py-1 text-xs disabled:opacity-30"
                      aria-label="Subir"
                      title="Subir"
                    >
                      ↑
                    </button>
                  </form>
                  <form action={moveItemAction}>
                    <input type="hidden" name="bundleId" value={bundleId} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <input type="hidden" name="direction" value="1" />
                    <button
                      type="submit"
                      disabled={idx === items.length - 1}
                      className="hover:bg-accent rounded-md px-2 py-1 text-xs disabled:opacity-30"
                      aria-label="Bajar"
                      title="Bajar"
                    >
                      ↓
                    </button>
                  </form>
                  <form action={removeItemAction}>
                    <input type="hidden" name="bundleId" value={bundleId} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <button
                      type="submit"
                      className="hover:bg-destructive/10 text-destructive rounded-md px-2 py-1 text-xs"
                      aria-label="Quitar"
                      title="Quitar"
                    >
                      ×
                    </button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {isDraft ? (
        <form action={addFormAction} className="border-t pt-4">
          <input type="hidden" name="bundleId" value={bundleId} />
          <h3 className="mb-2 text-sm font-medium">Añadir formulación</h3>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No hay formulaciones aprobadas o publicadas pendientes de incluir.
            </p>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label htmlFor="evaluationId" className="sr-only">
                  Formulación
                </label>
                <select
                  id="evaluationId"
                  name="evaluationId"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm"
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} — {c.subjectName} · {c.courseName} ({c.totalQuestions} preg.)
                    </option>
                  ))}
                </select>
              </div>
              <AddSubmitButton disabled={!selectedId} />
            </div>
          )}
          {addState.error ? (
            <p className="text-destructive mt-2 text-xs">{addState.error}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
