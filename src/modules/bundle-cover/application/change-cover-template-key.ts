/**
 * Caso de uso: cambiar la variante (key) de plantilla de un bundle.
 *
 * Política: cambiar la key NO borra el body override existente. Si el
 * bundle tenía un override, queda apuntando a la nueva key. Esto le da al
 * admin dos caminos:
 *   1. "Cambiar y empezar limpio" → changeKey + resetOverride (en la UI).
 *   2. "Cambiar conservando mis ediciones" → solo changeKey.
 *
 * Validamos que la key nueva exista en el FS antes de escribir — si el
 * docente escribió una key mal en el form, fallamos rápido. Para hacer
 * esto en la capa de dominio (sin tocar FS), recibimos un `keyValidator`
 * inyectado por el container.
 */
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  DEFAULT_COVER_TEMPLATE_KEY,
  toCoverTemplateKey,
  type CoverTemplateKey,
  type CoverTemplateRepository,
  type CoverTemplateState,
} from "../domain/cover-template";

export interface ChangeCoverTemplateKeyInput {
  actor: AuthenticatedUser;
  bundleId: string;
  /** Key nueva. Si null, vuelve a DEFAULT_COVER_TEMPLATE_KEY. */
  key: string | null;
}

/** Función inyectada que valida si la key existe como built-in. El container
 *  la implementa con `loader.listAvailableKeys()` (chequea FS) — el dominio
 *  la recibe para no depender del filesystem. */
export type KeyValidator = (key: CoverTemplateKey) => Promise<boolean>;

export class ChangeCoverTemplateKey implements UseCase<
  ChangeCoverTemplateKeyInput,
  CoverTemplateState
> {
  constructor(
    private readonly states: CoverTemplateRepository,
    private readonly isKnownKey: KeyValidator,
  ) {}

  async execute({
    actor,
    bundleId,
    key,
  }: ChangeCoverTemplateKeyInput): Promise<Result<CoverTemplateState>> {
    const authorized = requireRole(actor, "ECU_MASTER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    let resolved: CoverTemplateKey;
    if (key == null) {
      resolved = DEFAULT_COVER_TEMPLATE_KEY;
    } else {
      // El toCoverTemplateKey lanza ValidationError si la key no cumple el
      // patrón kebab-vN — lo atrapamos y devolvemos como Result.
      try {
        resolved = toCoverTemplateKey(key);
      } catch (err) {
        if (err instanceof ValidationError) return fail(err);
        throw err;
      }
      if (!(await this.isKnownKey(resolved))) {
        return fail(
          new ValidationError(
            `La variante "${key}" no existe en el sistema. Debe ser una de las plantillas built-in.`,
          ),
        );
      }
    }

    const state = await this.states.setKey(actor.institutionId, bundleId, resolved);
    return ok(state);
  }
}
