"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTemplateAction } from "../actions";

interface SectionRow {
  id: number;
  title: string;
  numQuestions: number;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "Guardando…" : "Guardar plantilla"}
    </Button>
  );
}

export function TemplateForm({ subjects }: { subjects: { id: string; label: string }[] }) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(createTemplateAction, {});
  const [sections, setSections] = useState<SectionRow[]>([{ id: 0, title: "", numQuestions: 5 }]);
  const nextId = useRef(1);

  function addSection() {
    setSections((prev) => [...prev, { id: nextId.current++, title: "", numQuestions: 5 }]);
  }

  function removeSection(id: number) {
    setSections((prev) => prev.filter((s) => s.id !== id));
  }

  function updateSection(id: number, field: keyof SectionRow, value: string | number) {
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="sectionCount" value={sections.length} />

      <div className="bg-card space-y-4 rounded-xl border p-6">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">
            Nombre de la plantilla
          </label>
          <Input name="name" required placeholder="Ej: Examen bimestral 11°" />
        </div>

        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">
            Descripción (opcional)
          </label>
          <Input name="description" placeholder="Ej: 20 preguntas, 4 secciones" />
        </div>

        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">
            Asignatura · Curso
          </label>
          <select
            name="courseSubjectId"
            required
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            <option value="">Seleccionar…</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-card space-y-3 rounded-xl border p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Secciones</h3>
          <Button type="button" variant="outline" size="sm" onClick={addSection}>
            + Agregar sección
          </Button>
        </div>

        {sections.length === 0 && (
          <p className="text-muted-foreground text-sm">Agrega al menos una sección.</p>
        )}

        {sections.map((sec, idx) => (
          <div key={sec.id} className="flex items-end gap-3 rounded-lg border p-3">
            <div className="flex-1 space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">
                Título de la sección
              </label>
              <Input
                name={`sectionTitle_${idx}`}
                value={sec.title}
                onChange={(e) => updateSection(sec.id, "title", e.target.value)}
                placeholder="Ej: Competencias ciudadanas"
              />
            </div>
            <div className="w-32 space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">Preguntas</label>
              <Input
                name={`sectionNumQ_${idx}`}
                type="number"
                min={1}
                value={sec.numQuestions}
                onChange={(e) => updateSection(sec.id, "numQuestions", Number(e.target.value))}
              />
            </div>
            {sections.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive mb-0.5"
                onClick={() => removeSection(sec.id)}
              >
                ×
              </Button>
            )}
          </div>
        ))}
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      <div className="flex items-center gap-3">
        <SubmitButton />
      </div>
    </form>
  );
}
