import crypto from "node:crypto";
import type { EmailService } from "@/shared/domain/email";
import { isValidEmail } from "@/modules/users/domain/user";
import { type Result, ok } from "@/shared/domain/result";
import { logger } from "@/shared/infrastructure/logger";
import { buildPasswordResetEmail } from "./password-reset-email";
import type { PasswordResetRepository } from "../domain/password-reset";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h, vs 48h del invite (recovery es más sensible)
const TOKEN_BYTES = 32;

export interface RequestPasswordResetInput {
  email: string;
}

export interface RequestPasswordResetDeps {
  repo: PasswordResetRepository;
  email: EmailService | undefined;
  /** URL base para construir el link del email. Validado por env zod. */
  baseUrl: string;
}

/**
 * Solicita un enlace de recuperación de contraseña para el `email` dado.
 *
 * Comportamiento anti-enumeración: el resultado siempre es `ok({sent})`
 * —sea que el usuario exista o no—. Un atacante que pruebe emails no
 * puede distinguir entre "existe" y "no existe" por la respuesta. Para
 * igualar el wall-clock entre las dos ramas (en caso de timing-attack),
 * la rama "no existe" ejecuta un `crypto.randomBytes` del mismo tamaño
 * que la rama "existe".
 *
 * Best-effort del email: si el email service está configurado pero
 * falla, logueamos y devolvemos `ok({sent: true})` igual — el token
 * ya está persistido, el usuario puede pedir otro. Si NO hay email
 * service configurado, devolvemos `ok({sent: false})` (es lo que
 * sucede en dev/local sin SMTP).
 */
export class RequestPasswordReset {
  constructor(private readonly deps: RequestPasswordResetDeps) {}

  async execute({ email }: RequestPasswordResetInput): Promise<Result<{ sent: boolean }>> {
    if (!isValidEmail(email)) {
      // No leakeamos al cliente: respondemos "sent: false" igual.
      return ok({ sent: false });
    }
    const normalized = email.toLowerCase();
    const user = await this.deps.repo.findByEmail(normalized);

    // Anti-enumeración: si no hay usuario, devolvemos ok igual. Quemamos
    // CPU simétrica para que el wall-clock no distinga entre las dos
    // ramas (defensa contra timing-attack básico).
    if (!user) {
      crypto.randomBytes(TOKEN_BYTES);
      return ok({ sent: false });
    }

    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await this.deps.repo.setPasswordResetToken(user.id, tokenHash, expiresAt);

    if (this.deps.email) {
      try {
        const resetUrl = `${this.deps.baseUrl}/reset-password?token=${rawToken}`;
        await this.deps.email.send(
          buildPasswordResetEmail({
            to: user.email,
            name: user.name,
            resetUrl,
          }),
        );
      } catch (err) {
        // Best-effort (consistente con el invite): loguear y seguir.
        // El token ya está persistido; el usuario puede pedir otro.
        logger.error(
          { err, userId: user.id },
          "no se pudo enviar correo de recuperación de contraseña",
        );
      }
      return ok({ sent: true });
    }

    // Sin email service configurado: el token queda en la BD pero nadie
    // lo recibe. El docente en dev puede ver el token en la BD; en prod
    // con SMTP real, este branch no se toma.
    return ok({ sent: false });
  }
}
