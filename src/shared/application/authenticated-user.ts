import { ForbiddenError, type Result, fail, ok } from "@/shared/domain/result";

export type Role = "SUPER_ADMIN" | "ECU_MASTER" | "COORDINATOR" | "TEACHER";

/**
 * Identidad del actor que ejecuta un caso de uso.
 * Se construye en la capa de presentación (a partir de la sesión) y se pasa
 * explícitamente a los casos de uso — nunca leen la sesión por su cuenta.
 *
 * Regla multi-tenant: todo caso de uso de negocio filtra por `institutionId`.
 * PostgreSQL RLS actúa como segunda barrera (defensa en profundidad).
 */
export interface AuthenticatedUser {
  userId: string;
  institutionId: string;
  roles: Role[];
}

export function hasRole(user: AuthenticatedUser, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

export function requireRole(user: AuthenticatedUser, ...roles: Role[]): Result<AuthenticatedUser> {
  if (!hasRole(user, ...roles)) {
    return fail(new ForbiddenError(`Se requiere uno de los roles: ${roles.join(", ")}`));
  }
  return ok(user);
}
