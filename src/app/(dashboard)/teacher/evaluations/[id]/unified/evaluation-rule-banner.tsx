import { cn } from "@/lib/utils";

/**
 * Banner soft (no bloqueante) que muestra la regla de conteo exacto
 * aplicable a la evaluación, si existe. Sprint ago 2026.
 *
 * Estados:
 *  - `delta === 0`: cumple la regla → verde.
 *  - `delta !== 0`: no cumple → ámbar, con CTA explicando que no podrá
 *    enviarla a revisión ni publicarla hasta ajustar.
 *
 * Es server component (no necesita estado del cliente). El editor
 * unificado lo coloca arriba de todo (`sticky top-0 z-10`) para que el
 * docente lo vea siempre.
 */

export interface EvaluationRuleBannerData {
  hasRule: true;
  exactQuestions: number;
  currentQuestions: number;
  delta: number;
}

export function EvaluationRuleBanner({ data }: { data: EvaluationRuleBannerData }) {
  const ok = data.delta === 0;
  return (
    <div
      role="status"
      className={cn(
        "sticky top-0 z-10 mb-4 rounded-md border px-4 py-2.5 text-sm",
        ok
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      {ok ? (
        <p>
          Esta evaluación cumple la regla de la prueba:{" "}
          <strong>
            {data.currentQuestions} / {data.exactQuestions} ítems
          </strong>
          .
        </p>
      ) : data.delta > 0 ? (
        <p>
          Esta evaluación tiene{" "}
          <strong>
            {data.currentQuestions} / {data.exactQuestions} ítems
          </strong>
          . La regla exige exactamente {data.exactQuestions}; no podrás enviarla a revisión ni
          publicarla hasta ajustar.
        </p>
      ) : (
        <p>
          Esta evaluación tiene{" "}
          <strong>
            {data.currentQuestions} / {data.exactQuestions} ítems
          </strong>
          . La regla exige exactamente {data.exactQuestions}.
        </p>
      )}
    </div>
  );
}
