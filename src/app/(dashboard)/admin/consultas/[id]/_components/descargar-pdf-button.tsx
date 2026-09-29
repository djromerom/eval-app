"use client";

import { useState } from "react";

/**
 * Botón "Descargar PDF" con loading overlay.
 *
 * El endpoint /admin/consultas/informe-grupo/export.pdf encola un job BullMQ
 * y espera hasta 90s al worker. Sin feedback visual, durante ese tiempo el
 * usuario percibe "no hace nada" — sobre todo si el worker PDF no está
 * corriendo (caso típico en dev donde `pnpm worker:pdf` es un proceso aparte).
 *
 * Click:
 * 1. Abre overlay con blur sobre toda la página + spinner.
 * 2. fetch al endpoint; si OK, descarga vía blob URL programático.
 * 3. Si error (worker caído → 504, validación → 400, etc.), muestra el
 *    mensaje que devuelve el route handler.
 * 4. Cierra overlay.
 *
 * Reemplaza solo al `<a>` del PDF. El XLSX sigue como `<a>` plano porque
 * la generación es casi instantánea y no necesita feedback.
 */
export function DescargarPdfButton({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        // El route handler responde { error: "..." } cuando el worker no
        // está activo o la combinación no es válida. Si por algún motivo la
        // respuesta no es JSON, caemos al status genérico.
        let msg = `Error ${res.status}`;
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string") msg = body.error;
        } catch {
          /* no JSON — keep generic */
        }
        setError(msg);
        return;
      }
      // OK — descargar el PDF como blob programático.
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      // Dejamos `download` vacío: el servidor ya pone Content-Disposition
      // con el nombre "informe-grupo-<grupo>-<prueba>.pdf".
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const showOverlay = loading || error !== null;

  return (
    <>
      <a href={href} onClick={onClick} className={className}>
        {children}
      </a>

      {showOverlay ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-busy={loading}
        >
          <div className="bg-card mx-4 flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 shadow-xl">
            {error ? (
              <>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="text-destructive size-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
                <p className="text-sm font-medium">No se pudo generar el PDF</p>
                <p className="text-muted-foreground text-center text-xs">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="border-input bg-background hover:bg-accent hover:text-accent-foreground mt-1 rounded-md border px-3 py-1 text-xs font-medium transition-colors"
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="text-primary size-8 animate-spin"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeOpacity="0.25"
                    strokeWidth="3"
                  />
                  <path
                    d="M22 12a10 10 0 0 1-10 10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <p className="text-sm font-medium">Generando PDF…</p>
                <p className="text-muted-foreground text-center text-xs">
                  Esto puede tardar hasta 90 segundos si el worker está ocupado.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
