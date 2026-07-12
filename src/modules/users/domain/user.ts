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
  findById(id: string): Promise<User | null>;
  /** Invitación: crea el usuario inactivo hasta que vincule cuenta o cree contraseña (§3.1). */
  invite(institutionId: string, email: string, name: string, roles: Role[]): Promise<User>;
  setRoles(institutionId: string, userId: string, roles: Role[]): Promise<void>;
}
