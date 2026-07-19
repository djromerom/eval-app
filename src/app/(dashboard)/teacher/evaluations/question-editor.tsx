"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { deleteQuestionAction } from "./actions";
import { QuestionForm, type QuestionInitialValues } from "./question-form";

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="ghost"
      disabled={pending}
      className="text-destructive hover:text-destructive"
    >
      {pending ? "Eliminando…" : "Eliminar"}
    </Button>
  );
}

/**
 * Envuelve una pregunta en modo lectura con los controles de editar/eliminar.
 * Al editar reutiliza `QuestionForm` con `initial`, en vez de duplicar el
 * formulario de alta (opciones variables, correcta, metadatos).
 *
 * El aviso de borrado menciona la renumeración: las preguntas siguientes
 * cambian de número, y el docente que ya imprimió un borrador debe saberlo.
 */
export function QuestionEditor({
  evaluationId,
  sectionId,
  questionNumber,
  initial,
  defaultOptions,
  maxOptions,
  children,
}: {
  evaluationId: string;
  sectionId: string;
  questionNumber: number;
  initial: QuestionInitialValues;
  defaultOptions: number;
  maxOptions: number;
  /** Render de la pregunta en modo lectura (server component). */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction] = useActionState<AdminFormState, FormData>(
    deleteQuestionAction,
    {},
  );

  if (editing) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-medium">
          Editando la pregunta {questionNumber}
        </p>
        <QuestionForm
          evaluationId={evaluationId}
          sectionId={sectionId}
          initial={initial}
          defaultOptions={defaultOptions}
          maxOptions={maxOptions}
          onDone={() => setEditing(false)}
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      {children}
      {deleteState.error ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {deleteState.error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Editar
        </Button>
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Se eliminará la pregunta ${questionNumber} y las siguientes se renumerarán. Esta acción no se puede deshacer.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="evaluationId" value={evaluationId} />
          <input type="hidden" name="questionId" value={initial.id} />
          <DeleteButton />
        </form>
      </div>
    </div>
  );
}
