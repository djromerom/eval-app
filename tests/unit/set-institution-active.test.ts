import { beforeEach, describe, expect, it } from "vitest";
import { SetInstitutionActive } from "@/modules/institutions/application/set-institution-active";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateInstitutionData,
  Institution,
  InstitutionRepository,
} from "@/modules/institutions/domain/institution";

/** Repositorio en memoria (mismo patrón que create-institution.test.ts). */
class InMemoryInstitutionRepository implements InstitutionRepository {
  readonly items: Institution[] = [];

  async findById(id: string) {
    return this.items.find((i) => i.id === id) ?? null;
  }
  async findBySlug(slug: string) {
    return this.items.find((i) => i.slug === slug) ?? null;
  }
  async findByCode(code: string) {
    return this.items.find((i) => i.code === code) ?? null;
  }
  async findAll() {
    return [...this.items];
  }
  async create(data: CreateInstitutionData) {
    const institution: Institution = {
      id: `id-${this.items.length + 1}`,
      name: data.name,
      slug: data.slug,
      code: data.code,
      logo: data.logo ?? null,
      theme: null,
      coverContent: null,
      isActive: true,
      createdAt: new Date(),
    };
    this.items.push(institution);
    return institution;
  }
  async setActive(id: string, isActive: boolean) {
    const item = this.items.find((i) => i.id === id);
    if (item) item.isActive = isActive;
  }
  async setCoverContent(id: string, coverContent: Record<string, unknown> | null) {
    const item = this.items.find((i) => i.id === id);
    if (item) item.coverContent = coverContent;
  }
}

const superAdmin: AuthenticatedUser = {
  userId: "u1",
  institutionId: "sys",
  roles: ["SUPER_ADMIN"],
};
const admin: AuthenticatedUser = { userId: "u2", institutionId: "i1", roles: ["ECU_MASTER"] };

describe("SetInstitutionActive", () => {
  let repo: InMemoryInstitutionRepository;
  let useCase: SetInstitutionActive;
  let id: string;

  beforeEach(async () => {
    repo = new InMemoryInstitutionRepository();
    useCase = new SetInstitutionActive(repo);
    const created = await repo.create({ name: "Demo", slug: "demo", code: "D1" });
    id = created.id;
  });

  it("desactiva una institución activa", async () => {
    const result = await useCase.execute({ actor: superAdmin, id, isActive: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.isActive).toBe(false);
    expect((await repo.findById(id))?.isActive).toBe(false);
  });

  it("rechaza a un actor que no es SUPER_ADMIN", async () => {
    const result = await useCase.execute({ actor: admin, id, isActive: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("devuelve NOT_FOUND si la institución no existe", async () => {
    const result = await useCase.execute({ actor: superAdmin, id: "inexistente", isActive: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
