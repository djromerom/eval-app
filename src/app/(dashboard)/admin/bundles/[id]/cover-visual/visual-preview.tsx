/**
 * Preview server-side de la portada (Cover Visual).
 * ===================================================
 *
 * Render estático del HTML actual del bundle vía `PreviewCover`. Se monta
 * en un iframe con `srcDoc` (no necesita URL base — los assets están
 * inline). El docente ve el resultado que se imprimirá al hacer PDF.
 *
 * ## Por qué server-side
 *
 * El render pasa por el mismo pipeline que `/cover-designer` y `/cover-studio`:
 * `RenderCover` (Mustache + DOMPurify). Si el proyecto visual está activo,
 * `PreviewCover` rutea a `RenderCoverVisual` (PR 2). El docente ve lo
 * MISMO que se imprimirá — no hay divergencia preview vs PDF.
 *
 * ## Refresh
 *
 * La página se re-renderiza en el server cuando el server action completa
 * (`revalidatePath("/admin/bundles/:id/cover-visual")`). El cliente no
 * necesita hacer polling — Next.js actualiza la página en la navegación
 * post-action.
 */

export interface VisualPreviewProps {
  /** HTML sanitizado listo para `srcDoc`. */
  html: string;
  /** Altura del iframe (CSS). Default 1000px para portada tabloid. */
  height?: number;
}

export function VisualPreview({ html, height = 1000 }: VisualPreviewProps) {
  return (
    <iframe
      title="Preview de portada"
      srcDoc={html}
      className="w-full rounded border bg-white"
      style={{ height: `${height}px` }}
      sandbox="allow-same-origin"
    />
  );
}
