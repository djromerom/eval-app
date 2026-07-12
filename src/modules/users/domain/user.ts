import type { Role } from "@/shared/application/authenticated-user";

export interface User {
  id: string;
  institutionId: string;
  email: string;
  name: string;
  image: string | null;
  roles: Role[];
  isActive: boolean;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(institutionId: string, id: string): Promise<User | null>;
  findAll(institutionId: string): Promise<User[]>;
  /** IDs de los usuarios activos con un rol dado (para notificaciones dirigidas). */
  findIdsByRole(institutionId: string, role: Role): Promise<string[]>;
  /** Invitación: crea el usuario inactivo hasta que vincule cuenta o cree contraseña (§3.1). */
  invite(institutionId: string, email: string, name: string, roles: Role[]): Promise<User>;
  setRoles(institutionId: string, userId: string, roles: Role[]): Promise<void>;
  setActive(institutionId: string, userId: string, isActive: boolean): Promise<void>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/**
 * Roles que un ADMIN puede asignar dentro de su institución (§2).
 * SUPER_ADMIN queda fuera: solo el dueño de la plataforma lo posee.
 */
export const ADMIN_ASSIGNABLE_ROLES: Role[] = ["ADMIN", "COORDINATOR", "TEACHER"];

export function areAssignableRoles(roles: Role[]): boolean {
  return roles.length > 0 && roles.every((r) => ADMIN_ASSIGNABLE_ROLES.includes(r));
}
