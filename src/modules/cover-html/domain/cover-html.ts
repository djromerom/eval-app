/**
 * Dominio: cover-html (4ª vista de portada) — ago 2026.
 * ======================================================
 *
 * Es la fuente de mayor precedencia para el HTML de portada, paralela a:
 *   • `coverTemplateBody` (override HTML crudo en /cover-designer / Monaco).
 *   • Built-in de la key (secundaria-v1.html, etc.).
 *
 * Si `coverLiveProject` está seteado, GANA sobre las otras dos en el render
 * (precedencia: live → HTML → built-in). El render usa el HTML
 * directamente — NO hay walker porque el componente `<HtmlLiveEditor>`
 * produce/edita un string HTML completo (no un proyecto estructurado).
 *
 * ## Forma del proyecto
 *
 * `CoverLiveProject` es un objeto simple:
 *
 *   {
 *     html: string,           // HTML completo que edita el docente
 *     previewMode?: boolean,  // UI state: oculta/oculta los marcadores de edición
 *   }
 *
 * Validado por Zod en `cover-html-schema.ts` antes de persistir.
 *
 * ## Por qué un módulo separado
 *
 * Separar "override HTML crudo" de "HTML editable via WYSIWYG" permite:
 *   • Validaciones independientes (tamaños, FORBIDDEN_TAG_PATTERNS).
 *   • Reset granular — `resetProject` borra solo el live, sin tocar el
 *     HTML override.
 *   • Migración gradual — el docente puede pasar de cover-designer a
 *     cover-html sin perder su override anterior (queda como fallback).
 */

import { DomainError } from "@/shared/domain/result";
import { type CoverTemplateKey } from "@/modules/bundle-cover/domain/cover-template";

/** Alias opaco del proyecto persistido en `coverLiveProject` (JSONB). */
export type CoverLiveProject = {
  html: string;
  previewMode?: boolean;
  /**
   * Paths relativos a STORAGE_DIR de los assets (imágenes base64)
   * extraídos en el último save (ago 2026, actualizado sep 2026). Después
   * del fix A ya NO incluimos SVGs (esos se guardan inline en `html`); el
   * campo solo lista imágenes `<img data:...>` que fueron a disco. El
   * render los inlea a data URLs (vía `inlineHtmlImages`) y el save los
   * borra antes de reemplazarlos. Si está vacío o ausente, no hay assets
   * extraídos.
   *
   * Mantener este campo sincronizado con el FS es responsabilidad del
   * server action: en cada save borra los paths viejos y persiste los
   * nuevos; en reset borra los actuales.
   */
  extractedAssets?: string[];
} & { readonly __brand: "CoverLiveProject" };

/** Helper para "castear" un objeto ya validado por Zod al alias del dominio.
 *  NO valida — eso lo hace el use case antes de llamar al repo. Solo
 *  etiqueta el tipo para que el compilador no se queje. */
export function toCoverLiveProject(value: unknown): CoverLiveProject {
  if (typeof value !== "object" || value === null) {
    throw new MalformedCoverLiveError("coverLiveProject no es un objeto.");
  }
  const v = value as { html?: unknown };
  if (typeof v.html !== "string") {
    throw new MalformedCoverLiveError("coverLiveProject.html debe ser un string.");
  }
  return value as CoverLiveProject;
}

/** Tamaño máximo del HTML persistido (en bytes UTF-8).
 *
 *  Subido de 200KB → 3MB (3 sep 2026, pedido del docente). Las portadas
 *  con SVGs grandes incrustados pueden acercarse al MB; el cap se ajustó
 *  para recibirlos sin tropezar antes con el use case. Se mantiene el
 *  cap razonable para evitar DOS por strings gigantes. */
export const MAX_COVER_LIVE_PROJECT_BYTES = 3 * 1024 * 1024;

/** Tamaño mínimo razonable: una portada vacía-pero-válida (solo el wrapper
 *  `<div></div>`) debe entrar. 50B es holgado para ese shape. */
export const MIN_COVER_LIVE_PROJECT_BYTES = 50;

/** Error de proyecto malformado — el JSON no pasa Zod o le faltan campos
 *  estructurales (`html`). Mapeo en route handlers: HTTP 400. */
export class MalformedCoverLiveError extends DomainError {
  constructor(message: string) {
    super("MALFORMED_COVER_LIVE", message);
    this.name = "MalformedCoverLiveError";
  }
}

/** Estado del cover HTML — es lo que ve la UI: si hay proyecto, cuándo se
 *  guardó, y a qué HTML caería si se restablece. */
export interface CoverLiveState {
  bundleId: string;
  /** `true` si `coverLiveProject != null`. */
  hasProject: boolean;
  /** Última vez que se guardó el proyecto. `null` si nunca se editó. */
  updatedAt: Date | null;
  /** Key efectiva que se usaría si el live se restablece. Espejo de
   *  `CoverTemplateState.key`. */
  fallbackKey: CoverTemplateKey;
  /** Source del fallback: BUILT_IN (no hay override) u OVERRIDE (hay HTML
   *  override que se usaría al restablecer el live). */
  fallbackSource: "BUILT_IN" | "OVERRIDE";
}

/** Puerto de persistencia del proyecto live. Implementado por
 *  `PrismaCoverLiveRepository`. Cada llamada filtra por `institutionId`
 *  para mantener el aislamiento tenant. Los métodos que no encuentran el
 *  bundle en la institución indicada lanzan `NotFoundError`. */
export interface CoverLiveRepository {
  /** Lee solo metadatos (no el JSON entero). Query barata para badges. */
  loadState(institutionId: string, bundleId: string): Promise<CoverLiveState>;

  /** Lee el HTML completo, o `null` si nunca se guardó. Query pesada —
   *  solo la usa el editor al abrir y el render al renderizar. */
  loadProject(institutionId: string, bundleId: string): Promise<CoverLiveProject | null>;

  /** Persiste el HTML como nueva fuente del render. Idempotente — sobrescribe
   *  cualquier proyecto previo. Setea `coverLiveUpdatedAt = now()`. NO valida
   *  tamaño ni shape — eso lo hace `SaveCoverLive` antes de llamar al repo. */
  saveProject(
    institutionId: string,
    bundleId: string,
    project: CoverLiveProject,
  ): Promise<CoverLiveState>;

  /** Borra el proyecto. El bundle vuelve a caer al HTML override o al built-in. */
  resetProject(institutionId: string, bundleId: string): Promise<CoverLiveState>;
}
