import { prisma } from "@/shared/infrastructure/db/prisma";
import type { PasswordResetRepository, UserResetSummary } from "../domain/password-reset";

const summarySelect = {
  id: true,
  email: true,
  name: true,
  passwordResetExpiresAt: true,
} as const;

function toSummary(row: {
  id: string;
  email: string;
  name: string;
  passwordResetExpiresAt: Date | null;
}): UserResetSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordResetExpiresAt: row.passwordResetExpiresAt,
  };
}

/**
 * Implementación Prisma del puerto `PasswordResetRepository`. Vive en
 * `infrastructure/` (única capa donde Prisma está permitida por la
 * layer rule del ESLint).
 *
 * Notas:
 *  - `findByResetTokenHash` aprovecha el `@unique` del campo
 *    `passwordResetToken` para un lookup directo (closed form bajo
 *    cualquiera de los miles de tokens activos, log N aprox).
 *  - `setPassword` limpia AMBOS campos del token (`passwordResetToken`
 *    + `passwordResetExpiresAt`) en la misma UPDATE para que el link
 *    no se pueda reusar después de aplicado.
 *  - `setPasswordResetToken` con un tokenHash cadena vacía y expiresAt
 *    epoch 0 se usa para "limpiar" un token expirado (reset-password
 *    use case). El caller nunca debería pasar `""` como token real.
 */
export class PrismaPasswordResetRepository implements PasswordResetRepository {
  async findByEmail(email: string): Promise<UserResetSummary | null> {
    const row = await prisma.user.findUnique({
      where: { email },
      select: summarySelect,
    });
    return row ? toSummary(row) : null;
  }

  async findByResetTokenHash(tokenHash: string): Promise<UserResetSummary | null> {
    const row = await prisma.user.findUnique({
      where: { passwordResetToken: tokenHash },
      select: summarySelect,
    });
    return row ? toSummary(row) : null;
  }

  async setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordResetToken: tokenHash, passwordResetExpiresAt: expiresAt },
    });
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });
  }
}
