import { beforeEach, describe, expect, it } from "vitest";
import { InviteUser, SetUserActive, SetUserRoles } from "@/modules/users/application/users";
import type { AuthenticatedUser, Role } from "@/shared/application/authenticated-user";
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
