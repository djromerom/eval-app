import { beforeEach, describe, expect, it } from "vitest";
import {
  InviteUser,
  ResendUserInvitation,
  SetUserActive,
  SetUserRoles,
} from "@/modules/users/application/users";
import type { AuthenticatedUser, Role } from "@/shared/application/authenticated-user";
import type { Email, EmailService } from "@/shared/domain/email";
import type { User, UserRepository } from "@/modules/users/domain/user";

class InMemoryUsers implements UserRepository {
  items: User[] = [];
  async findByEmail(email: string) {
    return this.items.find((u) => u.email === email) ?? null;
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((u) => u.institutionId === institutionId && u.id === id) ?? null;
  }
  async findAll(institutionId: string) {
    return this.items.filter((u) => u.institutionId === institutionId);
  }
  async findIdsByRole(institutionId: string, role: Role) {
    return this.items
      .filter((u) => u.institutionId === institutionId && u.isActive && u.roles.includes(role))
      .map((u) => u.id);
  }
  async invite(institutionId: string, email: string, name: string, roles: Role[]) {
    const u: User = {
      id: `u-${this.items.length + 1}`,
      institutionId,
      email,
      name,
      image: null,
      roles,
      isActive: false,
    };
    this.items.push(u);
    return u;
  }
  tokens: { userId: string; tokenHash: string }[] = [];
  async setInviteToken(userId: string, tokenHash: string, _expiresAt: Date) {
    this.tokens.push({ userId, tokenHash });
  }
  async setRoles(institutionId: string, userId: string, roles: Role[]) {
    const u = this.items.find((x) => x.id === userId);
    if (u) u.roles = roles;
  }
  async setActive(institutionId: string, userId: string, isActive: boolean) {
    const u = this.items.find((x) => x.id === userId);
    if (u) u.isActive = isActive;
  }
}

const admin: AuthenticatedUser = { userId: "admin", institutionId: "i1", roles: ["ADMIN"] };
const teacher: AuthenticatedUser = { userId: "t", institutionId: "i1", roles: ["TEACHER"] };

describe("InviteUser", () => {
  let repo: InMemoryUsers;
  let uc: InviteUser;
  beforeEach(() => {
    repo = new InMemoryUsers();
    uc = new InviteUser(repo);
  });

  it("invita con roles combinables (inactivo)", async () => {
    const r = await uc.execute({
      actor: admin,
      email: "Nuevo@Colegio.edu.co",
      name: "Nuevo",
      roles: ["TEACHER", "COORDINATOR"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("nuevo@colegio.edu.co"); // normalizado
      expect(r.value.isActive).toBe(false);
      expect(r.value.roles).toEqual(["TEACHER", "COORDINATOR"]);
    }
  });

  it("envía el correo de invitación cuando hay servicio de email", async () => {
    const sent: Email[] = [];
    const email: EmailService = {
      async send(e) {
        sent.push(e);
      },
    };
    const r = await new InviteUser(repo, email).execute({
      actor: admin,
      email: "nuevo@colegio.edu.co",
      name: "Nuevo",
      roles: ["COORDINATOR"],
      institutionName: "Colegio Test",
    });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("nuevo@colegio.edu.co");
    expect(sent[0]?.html).toContain("/accept-invite?token=");
    expect(repo.tokens).toHaveLength(1);
  });

  it("crea el usuario aunque falle el envío del correo", async () => {
    const email: EmailService = {
      async send() {
        throw new Error("SMTP caído");
      },
    };
    const r = await new InviteUser(repo, email).execute({
      actor: admin,
      email: "x@colegio.edu.co",
      name: "X",
      roles: ["COORDINATOR"],
      institutionName: "Colegio Test",
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza asignar SUPER_ADMIN", async () => {
    const r = await uc.execute({
      actor: admin,
      email: "x@y.com",
      name: "X",
      roles: ["SUPER_ADMIN"] as Role[],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza email duplicado y a un no-ADMIN", async () => {
    await uc.execute({ actor: admin, email: "a@b.com", name: "A", roles: ["TEACHER"] });
    const dup = await uc.execute({
      actor: admin,
      email: "a@b.com",
      name: "A2",
      roles: ["TEACHER"],
    });
    expect(dup.ok).toBe(false);
    const forbidden = await uc.execute({
      actor: teacher,
      email: "c@d.com",
      name: "C",
      roles: ["TEACHER"],
    });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.error.code).toBe("FORBIDDEN");
  });
});

describe("ResendUserInvitation", () => {
  let repo: InMemoryUsers;
  beforeEach(async () => {
    repo = new InMemoryUsers();
    await repo.invite("i1", "invitado@c.co", "Invitado", ["COORDINATOR"]);
  });

  it("reenvía la invitación a un usuario inactivo", async () => {
    const sent: Email[] = [];
    const email: EmailService = {
      async send(e) {
        sent.push(e);
      },
    };
    const r = await new ResendUserInvitation(repo, email).execute({
      actor: admin,
      userId: "u-1",
      institutionName: "Colegio Test",
    });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("invitado@c.co");
    expect(repo.tokens).toHaveLength(1);
  });

  it("falla si el SMTP no está configurado", async () => {
    const r = await new ResendUserInvitation(repo, undefined).execute({
      actor: admin,
      userId: "u-1",
      institutionName: "Colegio Test",
    });
    expect(r.ok).toBe(false);
  });

  it("falla si el usuario ya está activo", async () => {
    await repo.setActive("i1", "u-1", true);
    const email: EmailService = { async send() {} };
    const r = await new ResendUserInvitation(repo, email).execute({
      actor: admin,
      userId: "u-1",
      institutionName: "Colegio Test",
    });
    expect(r.ok).toBe(false);
  });

  it("surfacea el error cuando el envío falla", async () => {
    const email: EmailService = {
      async send() {
        throw new Error("SMTP caído");
      },
    };
    const r = await new ResendUserInvitation(repo, email).execute({
      actor: admin,
      userId: "u-1",
      institutionName: "Colegio Test",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/no se pudo enviar/i);
  });
});

describe("SetUserRoles / SetUserActive", () => {
  let repo: InMemoryUsers;
  beforeEach(() => {
    repo = new InMemoryUsers();
  });

  it("cambia roles de un usuario existente", async () => {
    const invited = await new InviteUser(repo).execute({
      actor: admin,
      email: "p@q.com",
      name: "P",
      roles: ["TEACHER"],
    });
    if (!invited.ok) throw new Error("setup");
    const r = await new SetUserRoles(repo).execute({
      actor: admin,
      userId: invited.value.id,
      roles: ["COORDINATOR", "TEACHER"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.roles).toEqual(["COORDINATOR", "TEACHER"]);
  });

  it("no permite desactivar la propia cuenta", async () => {
    const r = await new SetUserActive(repo).execute({
      actor: admin,
      userId: admin.userId,
      isActive: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
});
