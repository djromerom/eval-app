"use client";

import type { AnswerConfidence } from "@/modules/question-import/domain/parsed-question";

interface Props {
  level: AnswerConfidence;
  /** Justificación breve de la IA; se muestra en tooltip/detalle. */
  rationale?: string;
}

/**
 * Badge visual de confianza reportada por la fuente IA.
 *
 * Solo presente cuando el origen sabe juzgarla (saber-extractor). En CSV
 * y DOCX clásicos este componente no se renderiza — el docente marca la
 * respuesta a mano, no hay "confianza" que mostrar.
 *
 * - `alta`  → verde: el docente puede confiar sin re-revisar.
 * - `media` → ámbar: vale la pena ojear.
 * - `baja`  → rojo: re-revisión OBLIGATORIA. El review-form destilda la
 *             pregunta y exige corrección inline (ver `useEffect` de
 *             inicialización).
 */
export function ConfidenceBadge({ level, rationale }: Props) {
  const styles = STYLES[level];
  const ariaLabel = `Confianza ${level}${rationale ? `: ${rationale}` : ""}`;
  return (
    <span
      title={rationale ?? `Confianza ${level}`}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${styles.bg} ${styles.text}`}
    >
      <span aria-hidden>{styles.icon}</span>
      <span>Confianza {level}</span>
      {rationale ? (
        <details className="ml-1 inline">
          <summary className="cursor-pointer text-xs underline decoration-dotted">
            ¿por qué?
          </summary>
          <span className="bg-popover text-popover-foreground mt-1 block max-w-xs rounded-md border p-2 text-xs font-normal normal-case shadow-sm">
            {rationale}
          </span>
        </details>
      ) : null}
    </span>
  );
}

const STYLES: Record<
  AnswerConfidence,
  { bg: string; text: string; icon: string }
> = {
  alta: {
    bg: "bg-emerald-100 dark:bg-emerald-950",
    text: "text-emerald-800 dark:text-emerald-200",
    icon: "✓",
  },
  media: {
    bg: "bg-amber-100 dark:bg-amber-950",
    text: "text-amber-800 dark:text-amber-200",
    icon: "~",
  },
  baja: {
    bg: "bg-rose-100 dark:bg-rose-950",
    text: "text-rose-800 dark:text-rose-200",
    icon: "!",
  },
};