"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { deleteSectionAction, updateSectionAction } from "./actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : "Guardar"}
    </Button>
  );
}

function DeleteButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="ghost"
      disabled={pending}
      className="text-destructive hover:text-destructive"
    >
      {pending ? "Eliminando…" : label}
    </Button>
  );
}

/**
 * Cabecera editable de un contexto: muestra el título y, al pulsar "Editar",
 * un formulario con título + contenido rico precargados.
 *
 * El borrado arrastra las preguntas del contexto (cascade en la BD), así que
 * la confirmación dice cuántas se van a perder: es irreversible y el docente
 * puede no tener presente cuántas colgaban de ahí.
 */
export function SectionEditor({
  evaluationId,
  sectionId,
  heading,
  title,
  content,
  questionCount,
  children,
}: {
  evaluationId: string;
  sectionId: string;
  /** Rótulo que se muestra en lectura ("Contexto 1" o el título propio). */
  heading: string;
  title: string | null;
  content: unknown;
  questionCount: number;
  /** Render del contenido en modo lectura (RichText del server component). */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<AdminFormState, FormData>(updateSectionAction, {});
  const [deleteState, deleteAction] = useActionState<AdminFormState, FormData>(
    deleteSectionAction,
    {},
  );

  useEffect(() => {
    if (state.success) setEditing(false);
  }, [state.success]);

  if (editing) {
    return (
      <form action={formAction} className="space-y-2 rounded-lg border border-dashed p-4">
        <input type="hidden" name="evaluationId" value={evaluationId} />
        <input type="hidden" name="sectionId" value={sectionId} />
        <input
          name="title"
          defaultValue={title ?? ""}
          placeholder="Título del contexto (opcional)"
          className="border-input bg-background focus-visible:ring-ring h-9 w-full max-w-md rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
        />
        <div>
          <label className="text-muted-foreground mb-1 block text-xs font-medium">
            Contenido del contexto (texto, tablas, imágenes, fórmulas $…$)
          </label>
          <RichTextEditor name="content" defaultValue={content} minHeightClass="min-h-20" />
        </div>
        {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
        <div className="flex items-center gap-2">
          <SaveButton />
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b pb-2">
        <h2 className="font-semibold">{heading}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Editar
          </Button>
          <form
            action={deleteAction}
            onSubmit={(e) => {
              const aviso =
                questionCount > 0
                  ? `Se eliminará «${heading}» y sus ${questionCount} pregunta(s). Esta acción no se puede deshacer.`
                  : `Se eliminará «${heading}». Esta acción no se puede deshacer.`;
              if (!window.confirm(aviso)) e.preventDefault();
            }}
          >
            <input type="hidden" name="evaluationId" value={evaluationId} />
            <input type="hidden" name="sectionId" value={sectionId} />
            <DeleteButton label="Eliminar" />
          </form>
        </div>
      </div>
      {deleteState.error ? (
        <p className="text-destructive text-sm" role="alert">
          {deleteState.error}
        </p>
      ) : null}
      {children}
    </>
  );
}
