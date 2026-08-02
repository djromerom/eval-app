/**
 * Estado mínimo del usuario que el caso de uso de recovery necesita.
 * NO importar Prisma ni modelos ricos de otros módulos: la capa de
 * dominio solo conoce este contrato.
 */
export interface UserResetSummary {
  id: string;
  email: string;
  name: string;
  passwordResetExpiresAt: Date | null;
}

/**
 * Puerto del repositorio de password reset. La capa de infrastructure
 * (Prisma) implementa esta interfaz; el caso de uso depende solo de
 * este contrato.
 */
export interface PasswordResetRepository {
  /** Devuelve solo los campos necesarios para el reset. Null si no existe. */
  findByEmail(email: string): Promise<UserResetSummary | null>;
  /** Lookup directo por hash del token (cierra el leak del email en la URL). */
  findByResetTokenHash(tokenHash: string): Promise<UserResetSummary | null>;
  /** Sobrescribe cualquier token previo del usuario (un reset activo a la vez). */
  setPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Aplica la nueva contraseña y limpia el token. */
  setPassword(userId: string, passwordHash: string): Promise<void>;
}
