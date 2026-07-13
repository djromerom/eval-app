"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBankQuestionAction } from "./actions";

const KEYS = ["A", "B", "C", "D"] as const;

const SOLO = [
  { value: "", label: "Nivel SOLO (opcional)" },
  { value: "UNI_ESTRUCTURAL", label: "Uni-estructural" },
  { value: "MULTIESTRUCTURAL", label: "Multiestructural" },
  { value: "RELACIONAL", label: "Relacional" },
  { value: "ABSTRACTO_EXTENDIDO", label: "Abstracto extendido" },
];

const DIFFICULTY = [
  { value: "EASY", label: "Fácil" },
  { value: "MEDIUM", label: "Media" },
  { value: "HARD", label: "Difícil" },
];

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : "Guardar en el banco"}
    </Button>
  );
}

export function BankQuestionForm({ subjects }: { subjects: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    createBankQuestionAction,
    {},
  );
  const [correct, setCorrect] = useState("A");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setCorrect("A");
    }
  }, [state.success]);

  if (subjects.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay asignaturas disponibles.</p>;
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Asignatura</label>
          <select name="subjectId" required className={selectClass}>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Dificultad</label>
          <select name="difficulty" defaultValue="MEDIUM" className={selectClass}>
            {DIFFICULTY.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Nivel SOLO</label>
          <select name="soloLevel" className={selectClass}>
            {SOLO.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-muted-foreground text-xs font-medium">Enunciado</label>
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
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Componente MEN</label>
          <Input name="menComponent" placeholder="(opcional)" className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Competencia</label>
          <Input name="competency" placeholder="(opcional)" className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">
            Tags (separados por coma)
          </label>
          <Input name="tags" placeholder="álgebra, funciones" className="w-56" />
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="isPersonal" className="accent-primary" />
          Banco personal
        </label>
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? <p className="text-muted-foreground text-sm">Pregunta guardada.</p> : null}
      <SubmitButton />
    </form>
  );
}
