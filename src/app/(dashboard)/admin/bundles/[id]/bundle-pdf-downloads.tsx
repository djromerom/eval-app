"use client";

import { useState } from "react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PdfKind = "booklet" | "linear";

interface PdfConfig {
  url: string;
  filename: string;
  label: string;
  className: string;
}

/** Botones de descarga de PDF del cuadernillo (`/api/bundles/{id}/pdf` y
 *  `/api/bundles/{id}/pdf-linear`) con feedback full-screen mientras
 *  Puppeteer/Chromium genera el archivo server-side.
 *
 *  Sprint 2026-08-30:
 *  - Overlay con backdrop oscurecido + spinner + caption "Generando
 *    cuadernillo…" (decisión del docente — bloquear interacción mientras
 *    la generación corre).
 *  - Ambos botones quedan `disabled` cuando alguno está en curso
 *    (evita spamear la generación con 2 jobs simultáneos al worker PDF).
 *  - `toast.error(...)` si la request falla (consistencia con la saga
 *    "Volver a borrador" de la PR #65).
 *  - Sin toast de éxito: el archivo cayendo en /Downloads es confirmación
 *    suficiente.
 *
 *  Reemplaza a los 2 `<Link>` originales en `action-buttons.tsx` que
 *  navegaban directo al endpoint sin feedback de carga.
 *
 *  Patrón de descarga: `fetch → res.blob() → URL.createObjectURL → <a
 *  download>` (idéntico al `DownloadPdfButton` del docente). El filename
 *  viene del cliente para no depender del header `Content-Disposition`
 *  (el server lo setea pero `fetch().blob()` lo descarta). */
export function BundlePdfDownloads({ bundleId }: { bundleId: string }) {
  const [loadingKind, setLoadingKind] = useState<PdfKind | null>(null);

  const configs: Record<PdfKind, PdfConfig> = {
    booklet: {
      url: `/api/bundles/${bundleId}/pdf`,
      filename: `${bundleId}-bundle.pdf`,
      label: "Descargar cuadernillo (PDF)",
      className: cn(buttonVariants({ variant: "secondary", size: "sm" }), "w-full"),
    },
    linear: {
      url: `/api/bundles/${bundleId}/pdf-linear`,
      filename: `${bundleId}-bundle-linear.pdf`,
      label: "Descargar PDF",
      className: cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full"),
    },
  };

  async function download(kind: PdfKind) {
    const cfg = configs[kind];
    setLoadingKind(kind);
    try {
      const res = await fetch(cfg.url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo generar el PDF.");
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = cfg.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingKind(null);
    }
  }

  const disabled = loadingKind !== null;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void download("booklet")}
        className={configs.booklet.className}
      >
        {configs.booklet.label}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => void download("linear")}
        className={configs.linear.className}
      >
        {configs.linear.label}
      </button>

      {loadingKind !== null ? (
        <div
          role="status"
          aria-live="polite"
          aria-label="Generando cuadernillo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        >
          <div className="bg-card flex flex-col items-center gap-3 rounded-lg p-6 shadow-lg">
            <div className="border-primary h-10 w-10 animate-spin rounded-full border-4 border-t-transparent" />
            <p className="text-sm font-medium">Generando cuadernillo…</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
