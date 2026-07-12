import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { AuthenticatedUser, Role } from "@/shared/application/authenticated-user";
import { hasRole } from "@/shared/application/authenticated-user";

/**
 * Puente sesión → dominio: construye el AuthenticatedUser que reciben
 * los casos de uso. Usar en Server Components, Server Actions y route handlers.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    institutionId: session.user.institutionId,
    roles: session.user.roles,
  };
}

export async function requireAuthenticatedUser(...roles: Role[]): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  if (roles.length > 0 && !hasRole(user, ...roles)) redirect("/");
  return user;
}
