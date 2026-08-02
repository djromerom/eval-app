"use client";

import { useEffect } from "react";
import { Copy, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { richTextToPlain } from "@/components/editor/render";
import { deleteQuestionAction, duplicateQuestionAction } from "../../actions";

/** Forma mínima de la pregunta para pintar la modal de revisión. */
export interface QuestionLite {
  id: string;
  number: number;
  sectionId: string;
  text: unknown;
  options: { key: string; text: unknown }[];
  correctAnswer: string;
}

/**
 * Modal de revisión del ítem. Renderizada como overlay posicionado
 * (`fixed inset-0`), NO como `<dialog>` HTML nativo.
 *
 * Por qué no `<dialog>`: el user-agent stylesheet pone el dialog en
 * `display: block` con posición absoluta esquina-superior-izquierda sin
 * centrado robusto, lo que en muchos navegadores lo deja invisible o
 * descuadrado. Un `position: fixed` + flex centrado es predecible y
 * funciona idéntico al resto de modales del proyecto (no hay shadcn
 * `<Dialog>` instalado).
 *
 * Decisión (Jul 2026): cerramos con la X, el botón Cerrar, click sobre
 * el backdrop, o tecla ESC. Sin `AlertDialog` (no instalado); la
 * confirmación destructiva usa `window.confirm` consistente con
 * `question-editor.tsx`.
 */
export function ReviewModal({
  question,
  evaluationId,
  editable,
  onClose,
  onEdit,
}: {
  question: QuestionLite;
  evaluationId: string;
  editable: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  // Bloquea scroll del body mientras la modal está abierta.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Cierra con tecla ESC.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleDelete() {
    const ok = window.confirm(
      `Se eliminará la pregunta ${question.number} y las siguientes se renumerarán. Esta acción no se puede deshacer.`,
    );
    if (!ok) return;
    const fd = new FormData();
    fd.append("evaluationId", evaluationId);
    fd.append("questionId", question.id);
    void deleteQuestionAction({}, fd);
    onClose();
  }

  function handleDuplicate() {
    const fd = new FormData();
    fd.append("evaluationId", evaluationId);
    fd.append("questionId", question.id);
    void duplicateQuestionAction({}, fd);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // Cierra al hacer click en el backdrop (fuera del card).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 id="review-modal-title" className="font-display text-lg font-semibold">
            Enunciado {question.number}
          </h2>
          <Button type="button" size="icon" variant="ghost" onClick={onClose} aria-label="Cerrar">
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="text-muted-foreground mb-1 text-xs font-medium">Enunciado</p>
            <div className="bg-muted/30 rounded-md p-3 text-sm leading-snug">
              {(() => {
                try {
                  return richTextToPlain(question.text);
                } catch {
                  return "(sin enunciado)";
                }
              })()}
            </div>
          </div>

          <div>
            <p className="text-muted-foreground mb-1 text-xs font-medium">Opciones</p>
            <ul className="space-y-2">
              {question.options.map((opt) => {
                const isCorrect = opt.key === question.correctAnswer;
                return (
                  <li
                    key={opt.key}
                    className={
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm " +
                      (isCorrect
                        ? "border-primary bg-primary/10 font-medium"
                        : "border-border bg-card text-muted-foreground")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold " +
                        (isCorrect
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {opt.key}
                    </span>
                    <span className="leading-snug">
                      {(() => {
                        try {
                          return richTextToPlain(opt.text);
                        } catch {
                          return "(vacío)";
                        }
                      })()}
                    </span>
                    {isCorrect ? (
                      <span className="text-primary ml-auto text-[11px] font-semibold">
                        ✓ correcta
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {editable ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleDuplicate}>
              <Copy className="mr-1 h-3.5 w-3.5" /> Duplicar
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={handleDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
            </Button>
            <Button type="button" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
            </Button>
          </footer>
        ) : (
          <footer className="flex justify-end border-t px-5 py-3">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
          </footer>
        )}
      </div>
    </div>
  );
}
