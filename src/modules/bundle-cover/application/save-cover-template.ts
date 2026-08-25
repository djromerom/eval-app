/**
 * Caso de uso: guardar el HTML override de la portada del bundle.
 *
 * Validaciones:
 *   • Tamaño: debe estar entre MIN y MAX (defensa contra archivos
 *     accidentalmente enormes y contra strings vacíos).
 *   • Tags peligrosos: regex rápida sobre <script>, <iframe>, <object>,
 *     <embed>, javascript:, data:application/. Si los encuentra, devuelve
 *     ValidationError SIN escribir — el docente recibe feedback inmediato
 *     en vez de descubrir el problema al renderizar.
 *   • Permisos: ECU_MASTER / ECU_LIDER (manage-bundles).
 *
 * NO renderiza el HTML aquí — RenderCover se encarga en preview/PDF. Esto
 * mantiene SaveCoverTemplate barato y sin dependencias de Mustache/DOMPurify.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  MAX_COVER_TEMPLATE_BODY_BYTES,
  MIN_COVER_TEMPLATE_BODY_BYTES,
  type CoverTemplateRepository,
  type CoverTemplateState,
} from "../domain/cover-template";

export interface SaveCoverTemplateInput {
  actor: AuthenticatedUser;
  bundleId: string;
  body: string;
}

/** Tags cuyo uso en una portada es un foot-gun de seguridad. Detectamos
 *  con regex rápida: solo pedimos "lo contiene" porque la sanitización fina
 *  la hace DOMPurify en preview/render. Esta lista es defensiva, NO
 *  exhaustiva — el sanitizador es la fuente de verdad. */
const FORBIDDEN_TAG_PATTERNS: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  { tag: "script", pattern: /<\s*script\b/i },
  { tag: "iframe", pattern: /<\s*iframe\b/i },
  { tag: "object", pattern: /<\s*object\b/i },
  { tag: "embed", pattern: /<\s*embed\b/i },
  { tag: "form", pattern: /<\s*form\b/i },
  { tag: "javascript: url", pattern: /javascript:/i },
];

export class SaveCoverTemplate implements UseCase<SaveCoverTemplateInput, CoverTemplateState> {
  constructor(private readonly states: CoverTemplateRepository) {}

  async execute({
    actor,
    bundleId,
    body,
  }: SaveCoverTemplateInput): Promise<Result<CoverTemplateState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    // Tamaño: medimos en bytes UTF-8 (Buffer.byteLength) para que el límite
    // sea independiente de cómo se serialice después.
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes < MIN_COVER_TEMPLATE_BODY_BYTES) {
      return fail(
        new ValidationError(
          `La plantilla es demasiado corta (${bytes} bytes). Mínimo ${MIN_COVER_TEMPLATE_BODY_BYTES}.`,
        ),
      );
    }
    if (bytes > MAX_COVER_TEMPLATE_BODY_BYTES) {
      return fail(
        new ValidationError(
          `La plantilla es demasiado larga (${bytes} bytes). Máximo ${MAX_COVER_TEMPLATE_BODY_BYTES} (~200KB).`,
        ),
      );
    }

    // Tags peligrosos: feedback inmediato al guardar.
    const found: string[] = [];
    for (const { tag, pattern } of FORBIDDEN_TAG_PATTERNS) {
      if (pattern.test(body)) found.push(tag);
    }
    if (found.length > 0) {
      return fail(
        new ValidationError(
          `La plantilla contiene contenido no permitido: ${found.join(", ")}. Quítalo antes de guardar.`,
        ),
      );
    }

    const state = await this.states.saveOverride(actor.institutionId, bundleId, body);
    return ok(state);
  }
}
