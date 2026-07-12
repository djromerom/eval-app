import { beforeEach, describe, expect, it } from "vitest";
import { ImportStudents } from "@/modules/students/application/students";
import { parseStudentsCsv } from "@/modules/students/infrastructure/csv";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateStudentData,
  Student,
  StudentRepository,
} from "@/modules/students/domain/student";
import type { Group, GroupRepository } from "@/modules/academic/domain/types";

class InMemoryStudents implements StudentRepository {
  items: Student[] = [];
  async findById() {
    return null;
  }
  async findByCode(institutionId: string, code: string) {
    return this.items.find((s) => s.institutionId === institutionId && s.code === code) ?? null;
  }
  async findByCodeIncludingHistory() {
    return null;
  }
  async findByGroup() {
    return [];
  }
  async findAll(institutionId: string) {
    return this.items.filter((s) => s.institutionId === institutionId);
  }
  async create(institutionId: string, data: CreateStudentData) {
    const s: Student = { id: `s-${this.items.length + 1}`, institutionId, isActive: true, ...data };
    this.items.push(s);
    return s;
  }
  async createMany(institutionId: string, data: CreateStudentData[]) {
    for (const d of data) await this.create(institutionId, d);
    return data.length;
  }
  async changeCode() {}
}

class InMemoryGroups implements GroupRepository {
  constructor(private readonly groups: Group[]) {}
  async findAll(institutionId: string) {
    return this.groups.filter((g) => g.institutionId === institutionId);
  }
  async findById(institutionId: string, id: string) {
    return this.groups.find((g) => g.institutionId === institutionId && g.id === id) ?? null;
  }
  async create(): Promise<Group> {
    throw new Error("no usado");
  }
}

const admin: AuthenticatedUser = { userId: "u", institutionId: "i1", roles: ["ADMIN"] };
const groups: Group[] = [{ id: "g1", institutionId: "i1", courseId: "c1", name: "11-03" }];

const CSV = `nombre;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Ana Pérez;T.I.;123;EST-001;11-03;2026
Luis Gómez;C.C.;456;EST-002;11-03;2026`;

describe("parseStudentsCsv", () => {
  it("parsea encabezados con tildes y separador ;", () => {
    const { rows, missing } = parseStudentsCsv(CSV);
    expect(missing).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Ana Pérez", code: "EST-001", groupName: "11-03" });
    expect(rows[0]!.enrollmentYear).toBe(2026);
  });

  it("reporta columnas faltantes", () => {
    const { missing } = parseStudentsCsv("nombre,codigo\nAna,EST-1");
    expect(missing).toContain("groupName");
    expect(missing).toContain("idType");
  });
});

describe("ImportStudents", () => {
  let students: InMemoryStudents;
  let uc: ImportStudents;
  beforeEach(() => {
    students = new InMemoryStudents();
    uc = new ImportStudents(students, new InMemoryGroups(groups));
  });

  it("importa filas válidas y reporta errores por fila", async () => {
    const { rows } = parseStudentsCsv(
      `nombre;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Ana;T.I.;1;EST-001;11-03;2026
SinGrupo;C.C.;2;EST-002;99-99;2026
Dup;C.C.;3;EST-001;11-03;2026`,
    );
    const r = await uc.execute({ actor: admin, rows });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.created).toBe(1);
      expect(r.value.errors).toHaveLength(2);
      expect(r.value.errors[0]!.message).toContain("Grupo");
      expect(r.value.errors[1]!.message).toContain("Código");
    }
  });

  it("rechaza a un no-ADMIN", async () => {
    const { rows } = parseStudentsCsv(CSV);
    const r = await uc.execute({ actor: { ...admin, roles: ["TEACHER"] }, rows });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
