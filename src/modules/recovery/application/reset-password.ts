import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { type Result, fail, ok, ValidationError } from "@/shared/domain/result";
import { logger } from "@/shared/infrastructure/logger";
import type { PasswordResetRepository } from "../domain/password-reset";

export interface ResetPasswordInput {
  rawToken: string;
  password: string;
  passwordConfirm: string;
}

const MIN_PASSWORD_LENGTH = 6;

/**
 * Aplica una nueva contraseña a partir de un token de reset previamente
 * emitido por `RequestPasswordReset`.
 *
 * Validaciones:
 *  - password.length >= 6 (consistente con accept-invite).
 *  - password === passwordConfirm.
 *  - token existe en DB (lookup por sha256).
 *  - token no expiró (1h).
 *
 * En éxito: aplica `bcrypt.hash(password, 10)` y limpia el token del
 * usuario. La limpieza evita que el mismo link se reuse.
 *
 * Diferencias con `accept-invite/route.ts`:
 *  - Este use case respeta la capa hexagonal (NO toca Prisma).
 *  - Limpia el token expirado para no acumular filas "huérfanas".
 *  - Devuelve `Result<ValidationError>` en vez de throwing.
 */
export class ResetPassword {
  constructor(private readonly repo: PasswordResetRepository) {}

  async execute({
    rawToken,
    password,
    passwordConfirm,
  }: ResetPasswordInput): Promise<Result<void>> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return fail(new ValidationError("La contraseña debe tener al menos 6 caracteres."));
    }
    if (password !== passwordConfirm) {
      return fail(new ValidationError("Las contraseñas no coinciden."));
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const user = await this.repo.findByResetTokenHash(tokenHash);
    if (!user) {
      return fail(new ValidationError("El enlace no es válido."));
    }
    if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      // Limpiamos el token expirado para no acumular. Best-effort: si
      // falla, igual devolvemos el error al usuario.
      try {
        await this.repo.setPasswordResetToken(user.id, "", new Date(0));
      } catch (err) {
        logger.warn({ err, userId: user.id }, "no se pudo limpiar token expirado");
      }
      return fail(
        new ValidationError(
          "El enlace ha expirado. Solicita uno nuevo desde la pantalla de login.",
        ),
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.repo.setPassword(user.id, passwordHash);

    logger.info({ userId: user.id }, "password reset exitoso");
    return ok(undefined);
  }
}
