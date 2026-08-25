"use client";

/**
 * Form del editor HTML Live de portada (Cover HTML, ago 2026).
 * =============================================================
 *
 * Carga el editor `<HtmlLiveEditor>` (componente React con iframe interno).
 * El botón "Guardar HTML live" y su estado viven dentro del editor (toolbar
 * superior) — antes estaban en una columna derecha con preview iframe que
 * era redundante con el editor. El reset del HTML live queda en este form
 * (separado del reset local del editor, que recarga `initialHtml`).
 *
 * ## Flujo
 *
 *   1. Mount → el editor arranca con `initialHtml` del bundle.
 *   2. Docente edita usando la toolbar del editor
 *      (Abrir / Pegar / Ejemplo / Reset / Vista previa / Guardar HTML live).
 *   3. Cada cambio actualiza el `currentHtml` interno del editor.
 *   4. Click "Guardar HTML live" → `saveCoverHtmlAction` (vía `useActionState`
 *      dentro del editor) → Zod + use case + revalidatePath → preview server
 *      side se actualiza.
 *   5. Click "Restablecer HTML live" (con confirmación inline) →
 *      `resetCoverHtmlAction` → revalidatePath → preview vuelve a visual /
 *      built-in.
 *
 * ## Permissions
 *
 * El server action verifica manage-bundles. La UI muestra los botones
 * deshabilitados si `editable === false` (bundle READY/PUBLISHED).
 */
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { HtmlLiveEditor } from "./html-live-editor";
import { resetCoverHtmlAction, type CoverHtmlFormState } from "./actions";

export interface CoverHtmlFormProps {
  bundleId: string;
  bundleName: string;
  /** HTML persistido (null si nunca se editó — editor arranca vacío). */
  initialHtml: string | null;
  /** false si el bundle está READY/PUBLISHED. */
  editable: boolean;
  /** true si hay un override HTML guardado (badge informational). */
  hasHtmlOverride: boolean;
}

export function CoverHtmlForm({
  bundleId,
  bundleName,
  initialHtml,
  editable,
  hasHtmlOverride,
}: CoverHtmlFormProps) {
  const [resetConfirm, setResetConfirm] = useState(false);
  const [, resetAction] = useActionState<CoverHtmlFormState, FormData>(
    (prev, fd) => resetCoverHtmlAction(bundleId, prev, fd),
    { status: "idle" },
  );

  return (
    <div className="space-y-4">
      {/* Header del editor + badges informativos */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Editor HTML</h2>
        <div className="flex flex-col items-end gap-1">
          {hasHtmlOverride && (
            <span className="text-muted-foreground text-xs">
              Este bundle también tiene un override HTML (Monaco).
            </span>
          )}
          <span className="text-muted-foreground text-xs">
            El HTML live tiene precedencia sobre el override.
          </span>
        </div>
      </div>

      {/* Editor (incluye save button + estado en su toolbar) */}
      <HtmlLiveEditor bundleId={bundleId} initialHtml={initialHtml ?? ""} editable={editable} />

      {!editable && (
        <p className="text-destructive text-xs">
          El cuadernillo está sellado. No puedes editar la portada.
        </p>
      )}

      {/* Reset del HTML live (borra de la BD) — separado del reset local del editor */}
      {editable && initialHtml != null && (
        <div className="space-y-2">
          <div className="bg-muted/30 space-y-1 rounded-md p-4 text-sm">
            <p className="font-medium">{bundleName}</p>
          </div>
          <form action={resetAction}>
            {resetConfirm ? (
              <div className="space-y-2">
                <p className="text-xs">
                  ¿Restablecer el HTML live? Volverá al visual, al override HTML o al built-in.
                </p>
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" size="sm">
                    Confirmar restablecer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setResetConfirm(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResetConfirm(true)}
              >
                Restablecer HTML live
              </Button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
