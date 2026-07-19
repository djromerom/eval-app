"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminFormState } from "@/components/admin/entity-form";
import { saveEvaluationSettingsAction } from "./actions";

interface Props {
  evaluationId: string;
  initialDurationMinutes: number | null;
  /** False si la evaluation no está en DRAFT — el form se renderiza readonly. */
  editable: boolean;
  totalQuestions: number;
  minutesPerQuestion: number;
}

interface ActionState extends AdminFormState {
  durationMinutes?: number | null;
}

/**
 * Form del panel Settings. Inputs:
 *   - durationMinutes (number, opcionalmente vacío = null)
 * Botón submit deshabilitado si `!editable`.
 *
 * NOTA: el padre (page.tsx) provee `initialDurationMinutes` para mostrar el
 * valor actual. Si es null, el placeholder sugiere calcular a partir de
 * `totalQuestions * minutesPerQuestion`.
 */
export function EvaluationSettingsForm({
  evaluationId,
  initialDurationMinutes,
  editable,
  totalQuestions,
  minutesPerQuestion,
}: Props) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    (prev, fd) => saveEvaluationSettingsAction(evaluationId, prev, fd) as Promise<ActionState>,
    {},
  );
  const fallbackMinutes = Math.round(totalQuestions * minutesPerQuestion);

  return (
    <form action={formAction} className="bg-card space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Duración estimada</h2>
        <p className="text-muted-foreground text-xs">
          Tiempo total en minutos para esta evaluación. Aparece en la portada del compendio. Déjalo
          vacío para usar el cálculo por defecto ({totalQuestions} × {minutesPerQuestion} ={" "}
          {fallbackMinutes} min).
        </p>
      </div>

      <fieldset disabled={!editable} className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Minutos</span>
          <Input
            type="number"
            name="durationMinutes"
            min={1}
            max={600}
            defaultValue={initialDurationMinutes ?? ""}
            placeholder={String(fallbackMinutes)}
            aria-describedby="duration-help"
            className="w-40"
          />
        </label>
        <p id="duration-help" className="text-muted-foreground text-xs">
          Entre 1 y 600 minutos (10 horas). Editable solo mientras la evaluación esté en BORRADOR.
        </p>
      </fieldset>

      {!editable ? (
        <p className="text-muted-foreground text-xs">
          La evaluación no está en BORRADOR. Para cambiar la duración, crea una nueva versión desde
          el flujo de revisión.
        </p>
      ) : null}

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? (
        <p className="text-success text-sm">
          Duración guardada. La portada del compendio usará este valor.
        </p>
      ) : null}

      <div className="flex gap-2 pt-2">
        <SubmitButton disabled={!editable} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Guardando…" : "Guardar duración"}
    </Button>
  );
}
