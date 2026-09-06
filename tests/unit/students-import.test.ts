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
  async findById(institutionId: string, id: string) {
    return this.items.find((s) => s.institutionId === institutionId && s.id === id) ?? null;
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
  async update(
    institutionId: string,
    id: string,
    data: {
      groupId: string;
      lastName1: string;
      lastName2: string;
      firstName1: string;
      firstName2: string;
      idType: string;
      idNumber: string;
      enrollmentYear: number;
      isActive: boolean;
    },
  ) {
    const s = this.items.find((x) => x.institutionId === institutionId && x.id === id);
    if (!s) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    Object.assign(s, data);
    return s;
  }
  async softDelete(institutionId: string, id: string) {
    const s = this.items.find((x) => x.institutionId === institutionId && x.id === id);
    if (!s) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    s.isActive = false;
  }
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
  async delete(): Promise<void> {
    // no usado en este test
  }
}

const admin: AuthenticatedUser = { userId: "u", institutionId: "i1", roles: ["ECU_MASTER"] };
const groups: Group[] = [{ id: "g1", institutionId: "i1", courseId: "c1", name: "11-03" }];

const CSV = `apellido1;apellido2;nombre1;nombre2;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Pérez;Gómez;Ana;;T.I.;123;EST-001;11-03;2026
García;;Luis;Carlos;C.C.;456;EST-002;11-03;2026`;

describe("parseStudentsCsv", () => {
  it("parsea encabezados con tildes y separador ;", () => {
    const { rows, missing } = parseStudentsCsv(CSV);
    expect(missing).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      lastName1: "Pérez",
      lastName2: "Gómez",
      firstName1: "Ana",
      firstName2: "",
      code: "EST-001",
      groupName: "11-03",
    });
    expect(rows[0]!.enrollmentYear).toBe(2026);
  });

  it("acepta columnas legacy 'nombre' y parte por whitespace", () => {
    const { rows, missing } = parseStudentsCsv(
      `nombre;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Pérez Gómez Ana;T.I.;1;EST-1;11-03;2026`,
    );
    expect(missing).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      lastName1: "Pérez",
      lastName2: "Gómez",
      firstName1: "Ana",
      firstName2: "",
    });
  });

  it("reporta columnas faltantes", () => {
    const { missing } = parseStudentsCsv("apellido1,codigo\nPérez,EST-1");
    expect(missing).toContain("firstName1");
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
      `apellido1;apellido2;nombre1;nombre2;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Pérez;;Ana;;T.I.;1;EST-001;11-03;2026
Sin;;Grupo;;C.C.;2;EST-002;99-99;2026
Dup;;Otro;;C.C.;3;EST-001;11-03;2026`,
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
