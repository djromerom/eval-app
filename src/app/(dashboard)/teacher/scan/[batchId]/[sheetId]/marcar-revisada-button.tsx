"use client";

import { useState, useTransition } from "react";
import { marcarRevisadaAction } from "./actions";

/** Confirma que un humano miró las marcas ambiguas y la nota es válida.
 *
 *  Pide confirmación porque no hay vuelta atrás por interfaz: una vez en
 *  COMPLETED, no existe acción que devuelva la hoja a REVIEW. */
export function MarcarRevisadaButton({ sheetId, batchId }: { sheetId: string; batchId: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  function onClick() {
    if (
      !window.confirm(
        "¿Confirmar que revisaste las marcas ambiguas y la calificación es correcta?\n\n" +
          "La hoja pasará a Calificada. No hay forma de deshacerlo desde la interfaz.",
      )
    ) {
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const r = await marcarRevisadaAction({ sheetId, batchId });
      setFeedback(
        r.ok ? { tone: "ok", msg: "Marcada como revisada." } : { tone: "err", msg: r.error },
      );
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border border-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Marcar como revisada"}
      </button>
      {feedback && (
        <span
          className={`text-xs ${feedback.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}
        >
          {feedback.msg}
        </span>
      )}
    </span>
  );
}
