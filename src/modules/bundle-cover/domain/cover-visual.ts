/**
 * Dominio: proyecto visual (GrapesJS) de portada del cuadernillo (ago 2026).
 * =====================================================================
 *
 * Es la TERCERA fuente de HTML de portada, paralela a:
 *   • `coverTemplateBody` (override HTML crudo en /cover-designer).
 *   • Built-in de la key (secundaria-v1.html, etc.).
 *
 * Si `coverVisualProject` está seteado, GANA sobre las otras dos en el
 * render (ver `application/preview-cover.ts` y `application/render-cover-visual.ts`).
 * Ambos pueden coexistir: el docente puede tener override HTML y proyecto
 * visual guardados a la vez; las otras vistas muestran un banner no-bloqueante
 * avisando que el visual tiene precedencia.
 *
 * El dominio NO conoce GrapesJS, ni Prisma, ni el filesystem. Solo tipos
 * puros y el contrato de persistencia (paralelo a `cover-template.ts`).
 *
 * ## Forma del proyecto
 *
 * `CoverVisualProject` es un alias opaco de un JSON serializado por
 * GrapesJS (`editor.store()` / `editor.load()`). El shape exacto está
 * definido por Zod en `domain/cover-visual-schema.ts` (PR 3). Aquí en
 * `domain/` solo necesitamos el alias — `application/` y `infrastructure/`
 * son los que validan con Zod antes de persistir.
 *
 * ## Por qué un puerto separado
 *
 * Podríamos reusar `CoverTemplateRepository` (almacena todo en la misma
 * fila) pero eso acoplaría el modelo de "override HTML" con el de
 * "proyecto visual estructurado". Mantenerlos separados permite:
 *   • Validaciones independientes (tamaños, FORBIDDEN_TAG_PATTERNS, Zod).
 *   • Reset granular — `resetProject` borra solo el visual, sin tocar
 *     el HTML override.
 *   • Migración gradual — un bundle puede pasar de HTML a visual sin
 *     perder el HTML (queda como fallback).
 */

import { DomainError } from "@/shared/domain/result";
import { type CoverTemplateKey } from "./cover-template";

/**
 * JSON serializado del proyecto GrapesJS. Opaco desde el dominio — el
 * shape exacto lo describe Zod en `cover-visual-schema.ts` (PR 3).
 *
 * El branding `__brand` evita que se confunda con `unknown`/`any` en los
 * bordes del módulo sin obligar a parsear el JSON en cada llamada.
 */
export type CoverVisualProject = unknown & { readonly __brand: "CoverVisualProject" };

/**
 * Helper para "castear" un JSON ya validado por Zod al alias del dominio.
 * NO valida — eso lo hace el use case antes de llamar al repo. Solo
 * etiqueta el tipo para que el compilador no se queje.
 */
export function toCoverVisualProject(value: unknown): CoverVisualProject {
  return value as CoverVisualProject;
}

/**
 * Tamaño máximo del proyecto serializado (en bytes UTF-8).
 *
 * GrapesJS sin assets embebidos raramente supera 50KB; 1MB da holgura
 * para proyectos con SVGs inline grandes sin permitir DOS por strings
 * gigantes. Mismo orden de magnitud que `MAX_COVER_TEMPLATE_BODY_BYTES`
 * (200KB) con margen extra porque el visual puede incluir más estilos
 * serializados.
 */
export const MAX_COVER_VISUAL_PROJECT_BYTES = 1_000_000;

/**
 * Tamaño mínimo razonable: un proyecto vacío-pero-válido (la estructura
 * mínima `{ pages: [{ components: [] }] }`) debe entrar. 100B es holgado
 * para ese shape serializado.
 */
export const MIN_COVER_VISUAL_PROJECT_BYTES = 100;

/**
 * Error de proyecto malformado — el JSON no pasa Zod o le faltan campos
 * estructurales (`pages`, `components`). Distinto de
 * `UnsafeCoverTemplateError` porque el sanitizador no es el problema;
 * el problema es la forma del payload.
 *
 * Mapeo en route handlers: HTTP 400 (bad request).
 */
export class MalformedCoverVisualError extends DomainError {
  constructor(message: string) {
    super("MALFORMED_COVER_VISUAL", message);
    this.name = "MalformedCoverVisualError";
  }
}

/**
 * Estado del cover visual — análogo a `CoverTemplateState`. Es lo que
 * ve la UI: si hay proyecto, cuándo se guardó, y a qué HTML caería si
 * se restablece (el `fallback`).
 */
export interface CoverVisualState {
  bundleId: string;
  /** `true` si `coverVisualProject != null`. */
  hasProject: boolean;
  /** Última vez que se guardó el proyecto. `null` si nunca se editó. */
  updatedAt: Date | null;
  /**
   * Key efectiva que se usaría si el visual se restablece. Espejo de
   * `CoverTemplateState.key` para que el render fallback al HTML correcto.
   */
  fallbackKey: CoverTemplateKey;
  /**
   * Source del fallback: BUILT_IN (no hay `coverTemplateBody`) u OVERRIDE
   * (hay override HTML que se usaría al restablecer el visual).
   *
   * Esto permite a la UI del visual mostrar un badge tipo "Si restableces,
   * vuelves al HTML override / al built-in".
   */
  fallbackSource: "BUILT_IN" | "OVERRIDE";
}

/**
 * Puerto de persistencia del proyecto visual. Implementado por
 * `PrismaCoverVisualRepository` (PR 2 — columnas `coverVisualProject` y
 * `coverVisualUpdatedAt` en `EvaluationBundle`).
 *
 * Cada llamada filtra por `institutionId` para mantener el aislamiento
 * tenant — el dominio pasa el id explícito y la capa de aplicación lo
 * obtiene del actor autenticado (mismo patrón que `CoverTemplateRepository`).
 *
 * Los métodos que no encuentran el bundle en la institución indicada
 * lanzan `NotFoundError` (no devuelven null) — el dominio prefiere un
 * throw explícito a un optional que el caller puede olvidar.
 */
export interface CoverVisualRepository {
  /**
   * Lee solo metadatos (no el JSON entero). Es la query barata que usa
   * la UI para mostrar el badge "tiene proyecto visual" sin descargar
   * el JSONB entero. `fallbackKey` y `fallbackSource` vienen del estado
   * de la plantilla HTML (no del visual) — son el "qué pasaría si
   * restableces el visual".
   */
  loadState(institutionId: string, bundleId: string): Promise<CoverVisualState>;

  /**
   * Lee el JSON del proyecto completo, o `null` si nunca se guardó.
   * Es la query pesada (descarga el JSONB entero) — solo la usa el
   * editor visual al abrir y el render server al renderizar.
   */
  loadProject(institutionId: string, bundleId: string): Promise<CoverVisualProject | null>;

  /**
   * Persiste el proyecto como nueva fuente del render. Idempotente —
   * sobrescribe cualquier proyecto previo. Setea
   * `coverVisualUpdatedAt = now()`.
   *
   * NO valida tamaño ni shape — eso lo hace `SaveCoverVisual` en la
   * capa de aplicación antes de llamar al repo. El repo solo escribe.
   */
  saveProject(
    institutionId: string,
    bundleId: string,
    project: CoverVisualProject,
  ): Promise<CoverVisualState>;

  /**
   * Borra el proyecto (`coverVisualProject = null` y
   * `coverVisualUpdatedAt = null`). El bundle vuelve a caer a
   * `coverTemplateBody` o al built-in. NO toca el HTML override.
   */
  resetProject(institutionId: string, bundleId: string): Promise<CoverVisualState>;
}
