"use client";

import { useState, useTransition } from "react";
import { reprocessSheetAction } from "./actions";

interface ReprocessButtonProps {
  sheetId: string;
  batchId: string;
  disabled?: boolean;
}

export function ReprocessButton({ sheetId, batchId, disabled }: ReprocessButtonProps) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; msg: string } | null>(null);

  function onClick() {
    setFeedback(null);
    startTransition(async () => {
      const result = await reprocessSheetAction({ sheetId, batchId });
      if (result.ok) {
        setFeedback({ tone: "ok", msg: "Reprocesando…" });
      } else {
        setFeedback({
          tone: "err",
          msg: result.code === "ALREADY_RUNNING" ? "Ya está procesándose." : result.error,
        });
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || pending}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
      >
        {pending ? "Encolando…" : "Reprocesar"}
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
