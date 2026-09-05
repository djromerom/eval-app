/**
 * Caso de uso: persistir el HTML editable (cover-html, 4ª vista).
 * =================================================================
 *
 * Validaciones:
 *   • Permisos: ECU_MASTER / ECU_LIDER (manage-bundles).
 *   • Status: solo DRAFT — si el bundle está READY/PUBLISHED, se rechaza.
 *   • Tamaño: `MIN_COVER_LIVE_PROJECT_BYTES` ≤ bytes(utf8(html)) ≤
 *     `MAX_COVER_LIVE_PROJECT_BYTES`.
 *   • Shape: el HTML debe parsear como HTML válido (defensa adicional vía
 *     DOMPurify que ya se corre en `RenderCover`).
 *   • Tags peligrosos: re-corre `FORBIDDEN_TAG_PATTERNS` sobre el HTML.
 *     Defensa-en-profundidad — DOMPurify los sanitiza al renderizar, pero
 *     queremos feedback inmediato al guardar.
 *
 * NO renderiza el HTML aquí — `RenderCover` se encarga en preview/PDF.
 *
 * Aislamos `coverLiveProject` de cualquier mutación del HTML override:
 * SaveCoverHtml SOLO escribe el HTML live.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { type BundleRepository } from "@/modules/bundles/domain/bundle";
import { isLocked } from "@/modules/bundles/domain/bundle-status";
import {
  MAX_COVER_LIVE_PROJECT_BYTES,
  MIN_COVER_LIVE_PROJECT_BYTES,
  type CoverLiveProject,
  type CoverLiveRepository,
  type CoverLiveState,
} from "../domain/cover-html";

export interface SaveCoverHtmlInput {
  actor: AuthenticatedUser;
  bundleId: string;
  /** HTML ya validado por el server action / caller. El use case NO
   *  re-valida con Zod — solo verifica size + tags. */
  project: CoverLiveProject;
}

/** Tags cuyo uso en una portada es un foot-gun de seguridad. Detectamos
 *  con regex rápida. Esta lista es defensiva, NO exhaustiva — el
 *  sanitizador (DOMPurify) es la fuente de verdad. Misma lista que
 *  `SaveCoverTemplate` para criterio uniforme. */
const FORBIDDEN_TAG_PATTERNS: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  { tag: "script", pattern: /<\s*script\b/i },
  { tag: "iframe", pattern: /<\s*iframe\b/i },
  { tag: "object", pattern: /<\s*object\b/i },
  { tag: "embed", pattern: /<\s*embed\b/i },
  { tag: "form", pattern: /<\s*form\b/i },
  { tag: "javascript: url", pattern: /javascript:/i },
];

export class SaveCoverHtml implements UseCase<SaveCoverHtmlInput, CoverLiveState> {
  constructor(
    private readonly deps: {
      liveStates: CoverLiveRepository;
      bundles: BundleRepository;
    },
  ) {}

  async execute({ actor, bundleId, project }: SaveCoverHtmlInput): Promise<Result<CoverLiveState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // Status: solo DRAFT. Espejo de SaveCoverTemplate.
    const existing = await this.deps.bundles.findById(actor.institutionId, bundleId);
    if (!existing) return fail(new NotFoundError("Cuadernillo", bundleId));
    if (isLocked(existing.status)) {
      return fail(
        new ValidationError(
          "El cuadernillo está sellado (READY). Desmárcate primero para guardar el HTML live.",
        ),
      );
    }

    // Tamaño: medimos bytes UTF-8 del HTML (NO del JSON wrapper).
    const bytes = Buffer.byteLength(project.html, "utf8");
    if (bytes < MIN_COVER_LIVE_PROJECT_BYTES) {
      return fail(
        new ValidationError(
          `El HTML live es demasiado pequeño (${bytes} bytes). Mínimo ${MIN_COVER_LIVE_PROJECT_BYTES}.`,
        ),
      );
    }
    if (bytes > MAX_COVER_LIVE_PROJECT_BYTES) {
      return fail(
        new ValidationError(
          `El HTML live es demasiado grande (${bytes} bytes). Máximo ${MAX_COVER_LIVE_PROJECT_BYTES} (~3MB).`,
        ),
      );
    }

    // Tags peligrosos: feedback inmediato al guardar.
    const found: string[] = [];
    for (const { tag, pattern } of FORBIDDEN_TAG_PATTERNS) {
      if (pattern.test(project.html)) found.push(tag);
    }
    if (found.length > 0) {
      return fail(
        new ValidationError(
          `El HTML live contiene contenido no permitido: ${found.join(", ")}. Quítalo antes de guardar.`,
        ),
      );
    }

    const state = await this.deps.liveStates.saveProject(actor.institutionId, bundleId, project);
    return ok(state);
  }
}
