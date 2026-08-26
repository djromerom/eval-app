/**
 * Zod schema del proyecto cover-html persistido en
 * `EvaluationBundle.coverLiveProject`.
 * ============================================================
 *
 * Valida el shape del JSON antes de persistir. El walker/render
 * (`RenderCover`) vuelve a aplicar DOMPurify al renderizar — esta es la
 * primera línea de defensa (feedback inmediato al usuario con detalles
 * útiles del campo malo).
 *
 * Mantenemos este schema en `domain/` (no en `application/` ni en la ruta)
 * porque el dominio define el contrato de persistencia del proyecto.
 */

import { z } from "zod";

const htmlSchema = z.string().min(1); // sin cap de chars — el use case (save-cover-html) mide bytes UTF-8 con MAX_COVER_LIVE_PROJECT_BYTES (200KB). Zod previa tenía max(500_000) que era INCONSISTENTE con el use case (chars ≠ bytes UTF-8 con tildes).

export const coverLiveProjectSchema = z.object({
  html: htmlSchema,
  previewMode: z.boolean().optional(),
  /**
   * Paths de assets (SVGs + imágenes base64) extraídos en el save
   * (ago 2026). Validamos solo el shape (array de strings) — la
   * coherencia con el FS la mantiene el server action.
   */
  extractedAssets: z.array(z.string()).optional(),
});

/** Inferencia de tipos para usar en la capa de presentación. */
export type CoverLiveProjectParsed = z.infer<typeof coverLiveProjectSchema>;
