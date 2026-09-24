/**
 * Sigla de asignatura (encabezados del Informe detallado por grupo).
 * Reglas: la asignatura propia la edita el ECU_MASTER de su institución; la
 * del catálogo global, solo el SUPER_ADMIN (la sigla es una sola y se ve en
 * todas las instituciones). Vacío = sin sigla (el informe muestra el nombre).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateSubjectData,
  Subject,
  SubjectRepository,
} from "@/modules/academic/domain/types";
import { CreateSubject, UpdateSubjectShortName } from "@/modules/academic/application/subjects";

class InMemorySubjects implements SubjectRepository {
  items: Subject[] = [];
  async findAllForInstitution(institutionId: string) {
    return this.items.filter((s) => s.institutionId === institutionId || s.institutionId === null);
  }
  async findById(id: string) {
    return this.items.find((s) => s.id === id) ?? null;
  }
  async create(institutionId: string | null, data: CreateSubjectData) {
    const s: Subject = {
      id: `s-${this.items.length + 1}`,
      institutionId,
      name: data.name,
      code: data.code,
      shortName: data.shortName ?? null,
    };
    this.items.push(s);
    return s;
  }
  async updateShortName(id: string, shortName: string | null) {
    const s = this.items.find((x) => x.id === id)!;
    s.shortName = shortName;
    return s;
  }
}

const master: AuthenticatedUser = { userId: "m", institutionId: "i1", roles: ["ECU_MASTER"] };
const superAdmin: AuthenticatedUser = { userId: "s", institutionId: "i1", roles: ["SUPER_ADMIN"] };
const lider: AuthenticatedUser = { userId: "l", institutionId: "i1", roles: ["ECU_LIDER"] };
const otraInstitucion: AuthenticatedUser = {
  userId: "o",
  institutionId: "i2",
  roles: ["ECU_MASTER"],
};

let repo: InMemorySubjects;
let uc: UpdateSubjectShortName;

beforeEach(() => {
  repo = new InMemorySubjects();
  repo.items.push(
    { id: "propia", institutionId: "i1", name: "Biología", code: "BIO", shortName: null },
    { id: "global", institutionId: null, name: "Matemáticas", code: "MAT", shortName: null },
  );
  uc = new UpdateSubjectShortName(repo);
});

describe("UpdateSubjectShortName - permisos", () => {
  it("el ECU_MASTER edita la sigla de una asignatura de su institución", async () => {
    const r = await uc.execute({ actor: master, subjectId: "propia", shortName: "BIO" });
    expect(r.ok).toBe(true);
    expect(repo.items[0]!.shortName).toBe("BIO");
  });

  it("el ECU_MASTER NO edita una asignatura global", async () => {
    const r = await uc.execute({ actor: master, subjectId: "global", shortName: "MAT" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(repo.items[1]!.shortName).toBeNull();
  });

  it("el SUPER_ADMIN edita una asignatura global", async () => {
    const r = await uc.execute({ actor: superAdmin, subjectId: "global", shortName: "MAT" });
    expect(r.ok).toBe(true);
    expect(repo.items[1]!.shortName).toBe("MAT");
  });

  it("el ECU_LIDER no edita siglas", async () => {
    const r = await uc.execute({ actor: lider, subjectId: "propia", shortName: "BIO" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("la asignatura de otra institución responde NOT_FOUND", async () => {
    const r = await uc.execute({ actor: otraInstitucion, subjectId: "propia", shortName: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("una asignatura inexistente responde NOT_FOUND", async () => {
    const r = await uc.execute({ actor: master, subjectId: "nada", shortName: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("UpdateSubjectShortName - normalización", () => {
  it("recorta espacios", async () => {
    await uc.execute({ actor: master, subjectId: "propia", shortName: "  LENG. C.  " });
    expect(repo.items[0]!.shortName).toBe("LENG. C.");
  });

  it("vacío quita la sigla (null)", async () => {
    repo.items[0]!.shortName = "BIO";
    const r = await uc.execute({ actor: master, subjectId: "propia", shortName: "   " });
    expect(r.ok).toBe(true);
    expect(repo.items[0]!.shortName).toBeNull();
  });

  it("rechaza más de 20 caracteres", async () => {
    const r = await uc.execute({ actor: master, subjectId: "propia", shortName: "x".repeat(21) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.items[0]!.shortName).toBeNull();
  });
});

describe("CreateSubject - sigla opcional", () => {
  it("guarda la sigla recortada", async () => {
    const r = await new CreateSubject(repo).execute({
      actor: master,
      data: { name: "Física", code: "FIS", shortName: " FIS " },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.shortName).toBe("FIS");
  });

  it("sin sigla queda null", async () => {
    const r = await new CreateSubject(repo).execute({
      actor: master,
      data: { name: "Química", code: "QUI" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.shortName).toBeNull();
  });

  it("rechaza una sigla de más de 20 caracteres", async () => {
    const r = await new CreateSubject(repo).execute({
      actor: master,
      data: { name: "Química", code: "QUI", shortName: "x".repeat(21) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
});
