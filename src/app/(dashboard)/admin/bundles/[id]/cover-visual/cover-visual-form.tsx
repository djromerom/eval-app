"use client";

/**
 * Form del editor visual de portada (Cover Visual).
 * ==================================================
 *
 * Carga el editor GrapesJS vía `dynamic({ ssr: false })` (browser-only —
 * manipula DOM directamente). Muestra el preview server-side actualizado.
 *
 * ## Persistencia (PR 4)
 *
 * En esta fase (PR 3) el form NO persiste — los cambios solo viven en el
 * editor en memoria del navegador. El botón "Guardar" está deshabilitado
 * con tooltip explicativo. PR 4 añadirá:
 *   • `saveCoverVisualAction` y `resetCoverVisualAction` en `./actions.ts`.
 *   • `useActionState` para mostrar feedback de error/éxito.
 *   • Banner cross-tab en `/cover-designer` y `/cover-studio` cuando el
 *     proyecto visual está activo.
 *
 * ## Permissions
 *
 * `editable === false` cuando el bundle está READY/PUBLISHED — el editor
 * sigue siendo visible (read-only) pero todos los controles quedan
 * deshabilitados.
 */
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VisualPreview } from "./visual-preview";
import { reInjectMarkers } from "./reinject-markers";

// GrapesJS solo browser — dynamic ssr:false.
const GrapesJSEditor = dynamic(() => import("./grapesjs-editor"), {
  ssr: false,
  loading: () => (
    <div className="text-muted-foreground flex h-[800px] items-center justify-center rounded border bg-white text-sm">
      Cargando editor visual…
    </div>
  ),
});

export interface CoverVisualFormProps {
  bundleId: string;
  bundleName: string;
  /** Proyecto persistido (null si nunca se editó). */
  initialProject: unknown | null;
  /** HTML del preview actual (sanitizado server-side). */
  previewHtml: string;
  /** false si el bundle está READY/PUBLISHED. */
  editable: boolean;
  /** true si hay un override HTML guardado (badge informational). */
  hasHtmlOverride: boolean;
}

export function CoverVisualForm({
  bundleId,
  bundleName,
  initialProject,
  previewHtml,
  editable,
  hasHtmlOverride,
}: CoverVisualFormProps) {
  const [currentProject, setCurrentProject] = useState<unknown | null>(initialProject);

  const handleChange = (project: unknown) => {
    // Defensa-en-profundidad: anota cada componente studio-* con su
    // `data-studio-block` antes de pasar al padre (para que el JSON en
    // tránsito sea legible para logs / debug). El walker server-side
    // también normaliza — esto es solo documentación.
    try {
      reInjectMarkers(project);
    } catch {
      // Si falla la normalización, seguimos con el JSON crudo — el server
      // rechazará con MalformedCoverVisualError si hay algo realmente mal.
    }
    setCurrentProject(project);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      {/* Editor */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-medium">Editor visual</h2>
          {hasHtmlOverride && (
            <span className="text-muted-foreground text-xs">
              Este bundle también tiene un override HTML guardado. El visual tiene precedencia.
            </span>
          )}
        </div>
        <GrapesJSEditor initialProject={currentProject} onChange={handleChange} />
      </div>

      {/* Sidebar: preview + acciones */}
      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-sm font-medium">Preview</h3>
          <VisualPreview html={previewHtml} />
        </div>

        <div className="bg-muted/30 space-y-2 rounded-md p-4 text-sm">
          <p className="font-medium">{bundleName}</p>
          <p className="text-muted-foreground text-xs">
            {currentProject
              ? "Tienes cambios sin guardar. La persistencia llega en el próximo PR."
              : "Aún no has editado el visual."}
          </p>
        </div>

        {!editable && (
          <p className="text-destructive text-xs">
            El cuadernillo está sellado. No puedes editar la portada.
          </p>
        )}

        <Button type="button" disabled title="Persistencia habilitada en el próximo PR">
          Guardar proyecto visual
        </Button>

        {currentProject != null && (
          <Button
            type="button"
            variant="outline"
            disabled
            title="Persistencia habilitada en el próximo PR"
          >
            Restablecer visual
          </Button>
        )}
      </div>

      {/* No-op bridge que mantiene `bundleId` referenciado para evitar
        warnings de "unused prop" cuando el form se monte sin acciones. */}
      <span data-bundle-id={bundleId} hidden />
    </div>
  );
}
