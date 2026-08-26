import { beforeEach, describe, expect, it } from "vitest";
import { CreateInstitution } from "@/modules/institutions/application/create-institution";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateInstitutionData,
  Institution,
  InstitutionRepository,
} from "@/modules/institutions/domain/institution";

/** Repositorio en memoria: prueba el caso de uso sin base de datos. */
class InMemoryInstitutionRepository implements InstitutionRepository {
  private readonly items: Institution[] = [];

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
const teacher: AuthenticatedUser = { userId: "u2", institutionId: "i1", roles: ["TEACHER"] };

const validData: CreateInstitutionData = {
  name: "Colegio Nuevo",
  slug: "colegio-nuevo",
  code: "CN01",
};

describe("CreateInstitution", () => {
  let repo: InMemoryInstitutionRepository;
  let useCase: CreateInstitution;

  beforeEach(() => {
    repo = new InMemoryInstitutionRepository();
    useCase = new CreateInstitution(repo);
  });

  it("crea una institución cuando el actor es SUPER_ADMIN", async () => {
    const result = await useCase.execute({ actor: superAdmin, data: validData });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.slug).toBe("colegio-nuevo");
    expect(await repo.findAll()).toHaveLength(1);
  });

  it("rechaza a actores sin rol SUPER_ADMIN", async () => {
    const result = await useCase.execute({ actor: teacher, data: validData });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rechaza un slug inválido", async () => {
    const result = await useCase.execute({
      actor: superAdmin,
      data: { ...validData, slug: "Mal Slug!" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza slug duplicado", async () => {
    await useCase.execute({ actor: superAdmin, data: validData });
    const result = await useCase.execute({
      actor: superAdmin,
      data: { ...validData, code: "OTRO" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza código duplicado", async () => {
    await useCase.execute({ actor: superAdmin, data: validData });
    const result = await useCase.execute({
      actor: superAdmin,
      data: { ...validData, slug: "otro-slug" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });
});
