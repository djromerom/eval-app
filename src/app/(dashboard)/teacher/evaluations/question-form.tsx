"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addQuestionAction } from "./actions";

const KEYS = ["A", "B", "C", "D"] as const;

const SOLO_OPTIONS = [
  { value: "", label: "Nivel SOLO (opcional)" },
  { value: "UNI_ESTRUCTURAL", label: "Uni-estructural" },
  { value: "MULTIESTRUCTURAL", label: "Multiestructural" },
  { value: "RELACIONAL", label: "Relacional" },
  { value: "ABSTRACTO_EXTENDIDO", label: "Abstracto extendido" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Agregando…" : "Agregar pregunta"}
    </Button>
  );
}

/** Editor estructurado por pregunta (§3.3 v2.0): enunciado + A/B/C/D + correcta + metadatos. */
export function QuestionForm({
  evaluationId,
  sectionId,
}: {
  evaluationId: string;
  sectionId: string;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(addQuestionAction, {});
  const [correct, setCorrect] = useState<string>("A");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setCorrect("A");
    }
  }, [state.success]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-lg border border-dashed p-4"
    >
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <input type="hidden" name="sectionId" value={sectionId} />

      <div className="space-y-1">
        <label className="text-muted-foreground text-xs font-medium">
          Enunciado (soporta KaTeX $...$)
        </label>
        <textarea
          name="text"
          required
          rows={2}
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          placeholder="Escribe el enunciado…"
        />
      </div>

      <div className="space-y-2">
        {KEYS.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              <input
                type="radio"
                name="correctAnswer"
                value={k}
                checked={correct === k}
                onChange={() => setCorrect(k)}
                className="accent-primary"
              />
              {k}
            </label>
            <Input name={`option${k}`} required placeholder={`Opción ${k}`} className="flex-1" />
            {correct === k ? (
              <span className="text-primary text-xs font-medium">✓ correcta</span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Nivel SOLO</label>
          <select
            name="soloLevel"
            className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            {SOLO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Componente MEN</label>
          <Input name="menComponent" placeholder="(opcional)" className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Puntaje</label>
          <Input name="weight" type="number" step="0.5" defaultValue="1" className="w-24" />
        </div>
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
