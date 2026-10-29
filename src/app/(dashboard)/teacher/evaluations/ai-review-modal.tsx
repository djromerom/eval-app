"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiReviewArea } from "@/modules/ai-review/domain/ai-review";
import type { AiReviewResponse } from "./ai-review-actions";

/**
 * Overlay de espera de la revisión con IA.
 *
 * Bloquea la pantalla completa mientras el modelo responde: la llamada
 * tarda varios segundos y el docente tiene que ver que el guardado está
 * en curso (y no poder seguir toqueteando el formulario mientras tanto).
 *
 * Se monta en `document.body` para que el `position: fixed` no dependa
 * de que algún ancestro del formulario tenga `transform`.
 */
export function AiReviewOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-card flex flex-col items-center gap-3 rounded-xl border px-6 py-5 shadow-xl">
        <Loader2 className="text-primary h-7 w-7 animate-spin" aria-hidden="true" />
        <p className="text-sm font-medium">Revisando con IA…</p>
      </div>
    </div>,
    document.body,
  );
}

/** Etiqueta de cada zona del ítem revisada. */
const AREA_LABEL: Record<AiReviewArea, string> = {
  clave: "Clave",
  enunciado: "Enunciado",
  opciones: "Opciones de respuesta",
  contexto: "Contexto",
};

/**
 * Modal de revisión con IA.
 *
 * Aparece cuando la IA encuentra observaciones en el ítem que el docente
 * intentó guardar. Muestra el detalle de cada hallazgo (con su
 * justificación) y ofrece tres salidas:
 *
 *  - "Guardar sin tener en cuenta las sugerencias" → guarda el ítem tal
 *    como está.
 *  - "Corregirlo" → aplica la versión corregida por la IA (solo texto y
 *    opciones; las fórmulas e imágenes se conservan).
 *  - "Cancelar" → no guarda nada; el docente vuelve al formulario.
 *
 * Renderizada como overlay posicionado (`fixed inset-0`), NO como
 * `<dialog>` nativo — mismo criterio que la modal de revisión de ítems
 * (`unified/review-modal.tsx`): el `<dialog>` nativo no centra de forma
 * confiable en varios navegadores.
 */
export function AiReviewModal({
  review,
  onSaveAnyway,
  onCorrect,
  onCancel,
  applying = false,
}: {
  review: AiReviewResponse;
  onSaveAnyway: () => void;
  onCorrect: () => void;
  onCancel: () => void;
  /** `true` mientras se está aplicando la corrección (deshabilita los botones). */
  applying?: boolean;
}) {
  // Bloquea scroll del body mientras la modal está abierta.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Cierra con tecla ESC (equivale a "Cancelar": no se guarda nada).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const hayCorreccion = Boolean(review.correccion);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-review-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // Cierra al hacer click en el backdrop (fuera del card).
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b px-5 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <h2 id="ai-review-modal-title" className="font-display text-lg font-semibold">
                Revisión con IA
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                La IA encontró observaciones en la pregunta. Revisa las sugerencias antes de
                guardar.
              </p>
            </div>
          </div>
          <Button type="button" size="icon" variant="ghost" onClick={onCancel} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          {review.hallazgos.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              La IA no detalhó una justificación puntual, pero sugiere revisar el ítem antes de
              guardarlo.
            </p>
          ) : (
            review.hallazgos.map((hallazgo, i) => (
              <div key={i} className="rounded-lg border px-3 py-2">
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  {AREA_LABEL[hallazgo.area] ?? "Observación"}
                </p>
                <p className="mt-0.5 text-sm font-semibold">{hallazgo.titulo}</p>
                <p className="mt-1 text-sm leading-snug">{hallazgo.justificacion}</p>
                {hallazgo.sugerencia ? (
                  <p className="mt-1 text-sm leading-snug">
                    <span className="font-medium">Sugerencia: </span>
                    {hallazgo.sugerencia}
                  </p>
                ) : null}
              </div>
            ))
          )}

          {hayCorreccion ? (
            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              La IA propone una versión corregida del enunciado, las opciones y la clave. Las
              fórmulas y las imágenes no se modifican.
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={applying}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSaveAnyway}
            disabled={applying}
          >
            Guardar sin tener en cuenta las sugerencias
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onCorrect}
            disabled={applying || !hayCorreccion}
            title={hayCorreccion ? undefined : "La IA no propuso una corrección automática."}
          >
            Corregirlo
          </Button>
        </footer>
      </div>
    </div>
  );
}
