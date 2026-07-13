"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { addSectionAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Agregando…" : "+ Agregar bloque"}
    </Button>
  );
}

/** Alta de bloque de contexto: título opcional + contenido rico (TipTap + KaTeX). */
export function SectionForm({ evaluationId }: { evaluationId: string }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(addSectionAction, {});
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state.success) setResetKey((k) => k + 1);
  }, [state.success]);

  return (
    <form key={resetKey} action={formAction} className="space-y-2">
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <input
        name="title"
        placeholder="Título del bloque (opcional)"
        className="border-input bg-background focus-visible:ring-ring h-9 w-full max-w-md rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
      />
      <div>
        <label className="text-muted-foreground mb-1 block text-xs font-medium">
          Contenido del bloque (texto, tablas, imágenes, fórmulas $…$)
        </label>
        <RichTextEditor name="content" minHeightClass="min-h-20" />
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
