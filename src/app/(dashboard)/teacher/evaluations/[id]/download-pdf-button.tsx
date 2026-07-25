"use client";

import { useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

/**
 * Genera y descarga el PDF server-side (worker Puppeteer) con feedback de
 * carga.
 *
 * Variante por defecto: link de texto (`text-muted-foreground` +
 * `hover:underline`) — para mantener el aspecto discreto en filas de links
 * donde aún se use (p.ej. el legacy `/teacher/evaluations/[id]`).
 *
 * Variante `"button"`: usa `buttonVariants` para integrarse con la fila de
 * CTAs principales del header (al lado de "Importar con IA" en
 * `ContextsView`). Se conserva el feedback de error inline en ambos modos.
 */
export function DownloadPdfButton({
  evaluationId,
  kind = "booklet",
  label = "Descargar PDF",
  variant = "link",
  size = "sm",
}: {
  evaluationId: string;
  kind?: "booklet" | "answer-sheets" | "answer-key";
  label?: string;
  variant?: "link" | "button";
  size?: ButtonSize;
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

  const buttonClass =
    variant === "button" ? buttonVariants({ variant: "outline", size }) : undefined;

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={download}
        disabled={loading}
        className={
          buttonClass ?? "text-muted-foreground text-sm hover:underline disabled:opacity-60"
        }
      >
        {loading ? "Generando PDF…" : `${label} ↓`}
      </button>
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </span>
  );
}

// `VariantProps` se reexporta para mantener el tipo `ButtonVariant` y
// `ButtonSize` privados al módulo sin que TypeScript marque `import` como
// unused.
export type { ButtonVariant, ButtonSize };
