/**
 * Caso de uso: persistir el proyecto visual (GrapesJS) de portada.
 * =================================================================
 *
 * Validaciones:
 *   • Permisos: ECU_MASTER / ECU_LIDER (manage-bundles).
 *   • Status: solo DRAFT — si el bundle está READY/PUBLISHED, se rechaza.
 *   • Tamaño: `MIN_COVER_VISUAL_PROJECT_BYTES` ≤ bytes ≤
 *     `MAX_COVER_VISUAL_PROJECT_BYTES`, medido como bytes UTF-8 del JSON
 *     serializado (no del HTML resultante — el HTML puede ser más chico).
 *   • Shape: `serialiseProjectToHtml` valida la estructura y rechaza types
 *     desconocidos → `MalformedCoverVisualError`.
 *   • Tags peligrosos: re-corre `FORBIDDEN_TAG_PATTERNS` sobre el HTML
 *     serializado. Defensa-en-profundidad — DOMPurify los sanitiza al
 *     renderizar, pero queremos feedback inmediato al guardar.
 *
 * NO renderiza el HTML aquí — `RenderCoverVisual` se encarga en
 * preview/PDF. Esto mantiene `SaveCoverVisual` barato y testeable sin
 * Mustache/DOMPurify.
 *
 * Aislamos `coverVisualProject` de cualquier mutación del HTML override:
 * SaveCoverVisual SOLO escribe el proyecto visual. SaveCoverTemplate SOLO
 * escribe el HTML. ResetCoverVisual SOLO limpia el proyecto visual.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type BundleRepository } from "@/modules/bundles/domain/bundle";
import { isLocked } from "@/modules/bundles/domain/bundle-status";
import {
  type CoverVisualProject,
  type CoverVisualRepository,
  type CoverVisualState,
  MAX_COVER_VISUAL_PROJECT_BYTES,
  MIN_COVER_VISUAL_PROJECT_BYTES,
} from "../domain/cover-visual";
import { serialiseProjectToHtml } from "../domain/grapesjs-renderer";

export interface SaveCoverVisualInput {
  actor: AuthenticatedUser;
  bundleId: string;
  /** JSON del proyecto ya validado por el server action / caller.
   *  El use case NO re-valida con Zod — solo verifica size + shape + tags. */
  project: CoverVisualProject;
}

/** Tags cuyo uso en una portada es un foot-gun de seguridad. Detectamos
 *  con regex rápida. Esta lista es defensiva, NO exhaustiva — el
 *  sanitizador (DOMPurify) es la fuente de verdad. Idéntica a la usada
 *  en `SaveCoverTemplate` para mantener el criterio uniforme. */
const FORBIDDEN_TAG_PATTERNS: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  { tag: "script", pattern: /<\s*script\b/i },
  { tag: "iframe", pattern: /<\s*iframe\b/i },
  { tag: "object", pattern: /<\s*object\b/i },
  { tag: "embed", pattern: /<\s*embed\b/i },
  { tag: "form", pattern: /<\s*form\b/i },
  { tag: "javascript: url", pattern: /javascript:/i },
];

export class SaveCoverVisual implements UseCase<SaveCoverVisualInput, CoverVisualState> {
  constructor(
    private readonly deps: {
      visualStates: CoverVisualRepository;
      bundles: BundleRepository;
    },
  ) {}

  async execute({
    actor,
    bundleId,
    project,
  }: SaveCoverVisualInput): Promise<Result<CoverVisualState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // Status: solo DRAFT. Espejo de SaveCoverTemplate / UpdateBundleTheme.
    const existing = await this.deps.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para guardar el proyecto visual.",
        ),
      );
    }

    // Tamaño: medimos en bytes UTF-8 del JSON serializado (NO del HTML
    // resultante). Esto da un límite consistente independientemente de
    // cómo GrapesJS organice el árbol.
    const serialised = JSON.stringify(project);
    const bytes = Buffer.byteLength(serialised ?? "", "utf8");
    if (bytes < MIN_COVER_VISUAL_PROJECT_BYTES) {
      return fail(
        new ValidationError(
          `El proyecto visual es demasiado pequeño (${bytes} bytes). Mínimo ${MIN_COVER_VISUAL_PROJECT_BYTES}.`,
        ),
      );
    }
    if (bytes > MAX_COVER_VISUAL_PROJECT_BYTES) {
      return fail(
        new ValidationError(
          `El proyecto visual es demasiado grande (${bytes} bytes). Máximo ${MAX_COVER_VISUAL_PROJECT_BYTES} (~1MB).`,
        ),
      );
    }

    // Shape: el walker valida tipos y emite HTML. Si el proyecto tiene
    // un type desconocido, falla con MalformedCoverVisualError → 400.
    let serialisedHtml: string;
    try {
      serialisedHtml = serialiseProjectToHtml(project);
    } catch (err) {
      // MalformedCoverVisualError es un DomainError → lo envolvemos en
      // ValidationError para que la UI muestre el mensaje al docente.
      // Si NO es MalformedCoverVisualError, re-lanzamos (bug nuestro).
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "MALFORMED_COVER_VISUAL"
      ) {
        return fail(
          new ValidationError(
            `El proyecto visual no es válido: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
      throw err;
    }

    // Tags peligrosos: feedback inmediato al guardar. Defensivo — DOMPurify
    // los remueve al renderizar, pero queremos cortar antes de persistir.
    const found: string[] = [];
    for (const { tag, pattern } of FORBIDDEN_TAG_PATTERNS) {
      if (pattern.test(serialisedHtml)) found.push(tag);
    }
    if (found.length > 0) {
      return fail(
        new ValidationError(
          `El proyecto visual contiene contenido no permitido: ${found.join(", ")}. Quítalo antes de guardar.`,
        ),
      );
    }

    const state = await this.deps.visualStates.saveProject(actor.institutionId, bundleId, project);
    return ok(state);
  }
}
