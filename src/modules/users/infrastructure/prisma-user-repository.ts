import type { RoleType } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { Role } from "@/shared/application/authenticated-user";
import type { User, UserRepository } from "../domain/user";

type UserRow = {
  id: string;
  institutionId: string;
  email: string;
  name: string;
  image: string | null;
  isActive: boolean;
  roles: { role: RoleType }[];
};

function toUser(r: UserRow): User {
  return {
    id: r.id,
    institutionId: r.institutionId,
    email: r.email,
    name: r.name,
    image: r.image,
    isActive: r.isActive,
    roles: r.roles.map((x) => x.role as Role),
  };
}

const withRoles = { roles: { select: { role: true } } } as const;

export class PrismaUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    const row = await prisma.user.findUnique({
      where: { email },
      include: withRoles,
    });
    return row && toUser(row);
  }

  async findById(institutionId: string, id: string): Promise<User | null> {
    const row = await prisma.user.findFirst({
      where: { id, institutionId, deletedAt: null },
      include: withRoles,
    });
    return row && toUser(row);
  }

  async findAll(institutionId: string): Promise<User[]> {
    const rows = await prisma.user.findMany({
      where: { institutionId, deletedAt: null },
      include: withRoles,
      orderBy: { name: "asc" },
    });
    return rows.map(toUser);
  }

  async findIdsByRole(institutionId: string, role: Role): Promise<string[]> {
    const rows = await prisma.user.findMany({
      where: {
        institutionId,
        isActive: true,
        deletedAt: null,
        roles: { some: { role: role as RoleType } },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async invite(institutionId: string, email: string, name: string, roles: Role[]): Promise<User> {
    const row = await prisma.user.create({
      data: {
        institutionId,
        email,
        name,
        isActive: false, // invitado: se activa al vincular cuenta o definir contraseña
        roles: { create: roles.map((role) => ({ role: role as RoleType })) },
      },
      include: withRoles,
    });
    return toUser(row);
  }

  async setInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { inviteToken: tokenHash, inviteTokenExpiresAt: expiresAt },
    });
  }

  async setRoles(institutionId: string, userId: string, roles: Role[]): Promise<void> {
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.userRole.createMany({
        data: roles.map((role) => ({ userId, role: role as RoleType })),
      }),
    ]);
  }

  async setActive(institutionId: string, userId: string, isActive: boolean): Promise<void> {
    await prisma.user.updateMany({ where: { id: userId, institutionId }, data: { isActive } });
  }
}
