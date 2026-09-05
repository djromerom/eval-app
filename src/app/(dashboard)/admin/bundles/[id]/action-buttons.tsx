"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteBundleAction, toggleBundleReadyAction, type BundleFormState } from "../actions";
import { BundlePdfDownloads } from "./bundle-pdf-downloads";

function ToggleSubmit({ isDraft }: { isDraft: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        buttonVariants({ variant: isDraft ? "default" : "outline", size: "sm" }),
        "w-full",
      )}
    >
      {pending
        ? isDraft
          ? "Sellando…"
          : "Volviendo a borrador…"
        : isDraft
          ? "Marcar como listo"
          : "Volver a borrador"}
    </button>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive w-full")}
    >
      {pending ? "Eliminando…" : "Eliminar cuadernillo"}
    </button>
  );
}

/**
 * Panel lateral de acciones del cuadernillo. Sólo los formularios que pueden
 * fallar (toggle ready / delete) se renderizan acá como client components:
 * capturan `BundleFormState.error` y lo muestran en un mensaje inline,
 * evitando que un fallo de negocio (p.ej. formulación sin preguntas)
 * aparezca como Runtime Error overlay de Next.js.
 *
 * Los links de descarga / navegación (PDF, hojas, clave, reporte) se quedan
 * en el Server Component padre porque no fallan en el cliente.
 */
export function BundleActionPanel({ bundleId, isDraft }: { bundleId: string; isDraft: boolean }) {
  const [toggleState, toggleFormAction] = useActionState(
    toggleBundleReadyAction,
    {} as BundleFormState,
  );

  const [deleteState, deleteFormAction] = useActionState(deleteBundleAction, {} as BundleFormState);

  // El delete redirige vía `redirect()` en el action; cuando eso ocurre
  // no necesitamos renderizar nada del panel, pero useActionState igual
  // devuelve su último estado. No-op aquí.

  return (
    <div className="bg-card space-y-3 rounded-xl border p-6">
      <h2 className="font-semibold">Acciones</h2>

      {/* Ready / Unready */}
      <form action={toggleFormAction}>
        <input type="hidden" name="id" value={bundleId} />
        <input type="hidden" name="next" value={isDraft ? "READY" : "DRAFT"} />
        <ToggleSubmit isDraft={isDraft} />
      </form>

      {toggleState.error ? (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {toggleState.error}
        </p>
      ) : null}

      {/* Export LaTeX (Overleaf) — disponible también en DRAFT para que el
          docente pueda empezar a editar en Overleaf antes de sellar. La ruta
          /api/bundles/:id/latex-zip valida 403 si el cuadernillo está vacío
          o el rol no tiene manage-bundles. */}
      <Link
        href={`/api/bundles/${bundleId}/latex-zip`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
      >
        Descargar LaTeX (Overleaf)
      </Link>

      {/* Links estáticos (descargas / navegación) */}
      {!isDraft ? (
        <>
          {/* Sprint 2026-08-30: los 2 PDFs (cuadernillo booklet + lineal)
              muestran overlay full-screen mientras se generan. Ver
              `bundle-pdf-downloads.tsx` para el detalle del patrón. */}
          <BundlePdfDownloads bundleId={bundleId} />
          <Link
            href={`/admin/bundles/${bundleId}/answer-sheets`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
          >
            Generar hojas de respuesta
          </Link>
          <Link
            href={`/api/bundles/${bundleId}/answer-key/pdf`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
          >
            Descargar clave unificada
          </Link>
          <Link
            href={`/admin/bundles/${bundleId}/report`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
          >
            Reporte comparativo
          </Link>
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          Los PDFs se habilitan cuando el cuadernillo está <strong>listo</strong>.
        </p>
      )}

      {/* Eliminar (solo DRAFT) */}
      {isDraft ? (
        <>
          <form action={deleteFormAction}>
            <input type="hidden" name="id" value={bundleId} />
            <DeleteSubmit />
          </form>
          {deleteState.error ? (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
            >
              {deleteState.error}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
