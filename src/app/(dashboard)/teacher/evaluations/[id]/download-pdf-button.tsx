"use client";

import { useState } from "react";

/** Genera y descarga el PDF server-side (worker Puppeteer) con feedback de carga. */
export function DownloadPdfButton({
  evaluationId,
  kind = "booklet",
  label = "Descargar PDF",
}: {
  evaluationId: string;
  kind?: "booklet" | "answer-sheets" | "answer-key";
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/evaluations/${evaluationId}/pdf?kind=${kind}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo generar el PDF.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${evaluationId}-${kind}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={download}
        disabled={loading}
        className="text-muted-foreground text-sm hover:underline disabled:opacity-60"
      >
        {loading ? "Generando PDF…" : `${label} ↓`}
      </button>
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </span>
  );
}
