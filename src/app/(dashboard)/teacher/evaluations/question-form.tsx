"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { addQuestionAction, updateQuestionAction } from "./actions";
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  ANSWER_KEYS_ORDER,
} from "@/modules/evaluations/domain/evaluation";

const SOLO_OPTIONS = [
  { value: "", label: "Nivel SOLO (opcional)" },
  { value: "UNI_ESTRUCTURAL", label: "Uni-estructural" },
  { value: "MULTIESTRUCTURAL", label: "Multiestructural" },
  { value: "RELACIONAL", label: "Relacional" },
  { value: "ABSTRACTO_EXTENDIDO", label: "Abstracto extendido" },
];

const DEFAULT_COUNT = MAX_OPTIONS; // 4 por defecto

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  const label = editing ? "Guardar cambios" : "Agregar pregunta";
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : label}
    </Button>
  );
}

/**
 * Texto plano de una opción para precargar su `<input>`.
 *
 * Las opciones creadas desde este formulario se guardan como string, pero las
 * importadas del banco pueden venir como documento TipTap. Se recorre el JSON
 * en vez de reusar `richTextToPlain` de `editor/render` para no arrastrar
 * `@tiptap/html` + KaTeX al bundle del cliente.
 */
function plainOption(initial: QuestionInitialValues | undefined, key: string): string | undefined {
  if (!initial) return undefined;
  const value = initial.options.find((o) => o.key === key)?.text;
  return toPlain(value);
}

function toPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) return node.content.map(toPlain).join("");
  return "";
}

/** Datos de la pregunta que se está editando. Ausente = alta. */
export interface QuestionInitialValues {
  id: string;
  text: unknown;
  options: { key: string; text: unknown }[];
  correctAnswer: string;
  justification?: string | null;
  weight?: number;
  soloLevel?: string | null;
  menComponent?: string | null;
  competency?: string | null;
}

/** Editor estructurado por pregunta (§3.3 v2.0): enunciado + N opciones + correcta + metadatos.
 *
 *  El usuario puede ajustar el número de opciones entre MIN_OPTIONS y
 *  MAX_OPTIONS con los botones +/−. Al quitar la opción marcada como
 *  correcta, el cursor salta automáticamente a la primera visible.
 *  El tope MAX_OPTIONS está acotado por la hoja de respuestas
 *  institucional (plantilla ICFES) que solo tiene columnas A–D.
 *
 *  Los valores de `defaultOptions` y `maxOptions` vienen del .env
 *  (EVAL_DEFAULT_OPTIONS y EVAL_MAX_OPTIONS) inyectados por el
 *  server component padre. Permiten a la institución bajar el
 *  rango sin tocar código. El tope absoluto sigue siendo MAX_OPTIONS=8
 *  (la librería solo conoce claves A–H).
 */
export function QuestionForm({
  evaluationId,
  sectionId,
  defaultOptions = DEFAULT_COUNT,
  maxOptions = MAX_OPTIONS,
  initial,
  onDone,
}: {
  evaluationId: string;
  sectionId: string;
  defaultOptions?: number;
  maxOptions?: number;
  /** Si viene, el formulario edita esa pregunta en vez de crear una nueva. */
  initial?: QuestionInitialValues;
  /** Se invoca tras guardar con éxito (la vista de edición se cierra). */
  onDone?: () => void;
}) {
  const editing = initial !== undefined;
  const [state, formAction] = useActionState<AdminFormState, FormData>(
    editing ? updateQuestionAction : addQuestionAction,
    {},
  );
  const [optionCount, setOptionCount] = useState<number>(initial?.options.length ?? defaultOptions);
  const [correct, setCorrect] = useState<string>(initial?.correctAnswer ?? ANSWER_KEYS_ORDER[0]!);
  const [resetKey, setResetKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.success) return;
    if (editing) {
      // Al editar NO se limpia: el padre cierra el formulario y vuelve a la
      // vista de lectura, ya revalidada por el server action.
      onDone?.();
      return;
    }
    formRef.current?.reset();
    setOptionCount(defaultOptions);
    setCorrect(ANSWER_KEYS_ORDER[0]!);
    setResetKey((k) => k + 1); // remonta el editor para limpiarlo
  }, [state.success, defaultOptions, editing, onDone]);

  const visibleKeys = ANSWER_KEYS_ORDER.slice(0, optionCount);

  function addOption() {
    if (optionCount < maxOptions) setOptionCount((n) => n + 1);
  }
  function removeOption() {
    if (optionCount <= MIN_OPTIONS) return;
    const removedKey = ANSWER_KEYS_ORDER[optionCount - 1];
    setOptionCount((n) => n - 1);
    // Si la opción eliminada era la correcta, salta a la primera visible.
    if (correct === removedKey) {
      setCorrect(ANSWER_KEYS_ORDER[optionCount - 2]!);
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-lg border border-dashed p-4"
    >
      <input type="hidden" name="evaluationId" value={evaluationId} />
      <input type="hidden" name="sectionId" value={sectionId} />
      <input type="hidden" name="optionCount" value={optionCount} />
      {editing ? <input type="hidden" name="questionId" value={initial.id} /> : null}

      <div className="space-y-1">
        <label className="text-muted-foreground text-xs font-medium">Enunciado</label>
        <RichTextEditor
          key={resetKey}
          name="text"
          minHeightClass="min-h-16"
          defaultValue={initial?.text}
        />
      </div>

      <div className="space-y-2">
        {visibleKeys.map((k) => (
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
            <Input
              name={`option${k}`}
              required
              placeholder={`Opción ${k}`}
              className="flex-1"
              defaultValue={plainOption(initial, k)}
            />
            {correct === k ? (
              <span className="text-primary text-xs font-medium">✓ correcta</span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addOption}
          disabled={optionCount >= maxOptions}
          title={
            optionCount >= maxOptions
              ? `Máximo ${maxOptions} opciones (configurado en EVAL_MAX_OPTIONS)`
              : "Agregar opción"
          }
        >
          + Opción
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={removeOption}
          disabled={optionCount <= MIN_OPTIONS}
          title={optionCount <= MIN_OPTIONS ? `Mínimo ${MIN_OPTIONS} opciones` : "Quitar última"}
        >
          − Opción
        </Button>
        <span className="text-muted-foreground text-xs">
          {optionCount} de {maxOptions} opciones
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Nivel SOLO</label>
          <select
            name="soloLevel"
            defaultValue={initial?.soloLevel ?? ""}
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
          <Input
            name="menComponent"
            placeholder="(opcional)"
            className="w-40"
            defaultValue={initial?.menComponent ?? ""}
          />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Competencia</label>
          <Input
            name="competency"
            placeholder="(opcional)"
            className="w-40"
            defaultValue={initial?.competency ?? ""}
          />
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs font-medium">Puntaje</label>
          <Input
            name="weight"
            type="number"
            step="0.5"
            defaultValue={initial?.weight ?? 1}
            className="w-24"
          />
        </div>
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <SubmitButton editing={editing} />
    </form>
  );
}
