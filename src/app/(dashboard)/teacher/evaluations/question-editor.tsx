"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { deleteQuestionAction, duplicateQuestionAction } from "./actions";
import { QuestionForm, type QuestionInitialValues } from "./question-form";

/**
 * Forma mínima que necesitamos pintar la cabecera de la card de una
 * pregunta. Vive en el `QuestionEditor` (que es client component) y se
 * construye en el `context-editor.tsx` desde `QuestionLite`.
 */
export interface QuestionHeaderData {
  id: string;
  number: number;
  competency: string | null;
}

function DeleteIconButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="icon"
      variant="ghost"
      disabled={pending}
      title="Eliminar pregunta"
      aria-label="Eliminar pregunta"
      className="text-destructive hover:text-destructive h-7 w-7"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

/**
 * Envuelve una pregunta en modo lectura con un header que tiene los tres
 * controles principales (Editar / Duplicar / Eliminar) como iconos en la
 * esquina superior derecha. Al pulsar Editar se reemplaza la card por el
 * `QuestionForm`; al guardar o cancelar se vuelve a la card de lectura.
 *
 * Reutiliza el mismo formulario de alta (pasando `initial`), evitando
 * duplicar la lógica de opciones variables, correcta, metadatos.
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
  minOptions,
  maxOptions,
  header,
  children,
}: {
  evaluationId: string;
  sectionId: string;
  questionNumber: number;
  initial: QuestionInitialValues;
  defaultOptions: number;
  /** Mínimo de opciones permitido por la regla de (Prueba × Asignatura). */
  minOptions: number;
  maxOptions: number;
  /** Datos para la cabecera de la card (número, competencia, id). */
  header: QuestionHeaderData;
  /** Render del cuerpo de la pregunta en modo lectura. */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [deleteState, deleteAction] = useActionState<AdminFormState, FormData>(
    deleteQuestionAction,
    {},
  );
  // El server action de duplicar tiene firma de 2 args (patrón
  // `useActionState`); aquí lo invocamos directamente desde un `<form
  // action>`, así que lo envolvemos en un callable de 1 arg que ignora el
  // `prev state`.
  const duplicate = async (formData: FormData) => {
    await duplicateQuestionAction({}, formData);
  };

  if (editing) {
    return (
      <div className="bg-card space-y-2 rounded-lg border p-4">
        <p className="text-muted-foreground text-xs font-medium">
          Editando la pregunta {questionNumber}
        </p>
        <QuestionForm
          evaluationId={evaluationId}
          sectionId={sectionId}
          initial={initial}
          defaultOptions={defaultOptions}
          minOptions={minOptions}
          maxOptions={maxOptions}
          onDone={() => setEditing(false)}
        />
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
      </div>
    );
  }

  const competencyLabel = header.competency ?? "Sin competencia";
  return (
    <div className="bg-card rounded-lg border p-4">
      <header className="mb-3 flex items-start gap-3">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        >
          {header.number}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-[11px] font-semibold">
            {competencyLabel}
          </span>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium">
            Selección múltiple
          </span>
        </div>
        <div className="text-muted-foreground flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setEditing(true)}
            title="Editar pregunta"
            aria-label="Editar pregunta"
            className="h-7 w-7"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <form action={duplicate} title="Duplicar pregunta">
            <input type="hidden" name="evaluationId" value={evaluationId} />
            <input type="hidden" name="questionId" value={header.id} />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              title="Duplicar pregunta"
              aria-label="Duplicar pregunta"
              className="h-7 w-7"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </form>
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
            title="Eliminar pregunta"
          >
            <input type="hidden" name="evaluationId" value={evaluationId} />
            <input type="hidden" name="questionId" value={header.id} />
            <DeleteIconButton />
          </form>
        </div>
      </header>
      {children}
      {deleteState.error ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {deleteState.error}
        </p>
      ) : null}
    </div>
  );
}
