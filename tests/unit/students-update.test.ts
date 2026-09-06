import { beforeEach, describe, expect, it } from "vitest";
import { DeleteStudent, GetStudent, UpdateStudent } from "@/modules/students/application/students";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateStudentData,
  Student,
  StudentRepository,
  UpdateStudentData,
} from "@/modules/students/domain/student";
import type { Group, GroupRepository } from "@/modules/academic/domain/types";

class InMemoryStudents implements StudentRepository {
  items: Student[] = [];

  async findById(institutionId: string, id: string) {
    return this.items.find((s) => s.institutionId === institutionId && s.id === id) ?? null;
  }
  async findByCode(institutionId: string, code: string) {
    return (
      this.items.find(
        (s) => s.institutionId === institutionId && s.code === code && s.isActive !== false, // soft-deleted ya no aparece por código
      ) ?? null
    );
  }
  async findByCodeIncludingHistory() {
    return null;
  }
  async findByGroup(institutionId: string, groupId: string) {
    return this.items.filter((s) => s.institutionId === institutionId && s.groupId === groupId);
  }
  async findAll(institutionId: string) {
    return this.items.filter((s) => s.institutionId === institutionId);
  }
  async create(institutionId: string, data: CreateStudentData): Promise<Student> {
    const s: Student = {
      id: `s-${this.items.length + 1}`,
      institutionId,
      isActive: true,
      ...data,
    };
    this.items.push(s);
    return s;
  }
  async createMany(institutionId: string, data: CreateStudentData[]) {
    for (const d of data) await this.create(institutionId, d);
    return data.length;
  }
  async changeCode() {}
  async update(institutionId: string, id: string, data: UpdateStudentData): Promise<Student> {
    const s = this.items.find((x) => x.institutionId === institutionId && x.id === id);
    if (!s) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    Object.assign(s, data);
    return s;
  }
  async softDelete(institutionId: string, id: string): Promise<void> {
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
    /* no usado */
  }
}

const admin: AuthenticatedUser = {
  userId: "u",
  institutionId: "i1",
  roles: ["ECU_MASTER"],
};
const teacher: AuthenticatedUser = {
  userId: "t",
  institutionId: "i1",
  roles: ["TEACHER"],
};

const baseStudent = (over: Partial<Student> = {}): Student => ({
  id: "s-1",
  institutionId: "i1",
  groupId: "g1",
  lastName1: "PÉREZ",
  lastName2: "",
  firstName1: "ANA",
  firstName2: "",
  idType: "C.C.",
  idNumber: "123",
  code: "EST-001",
  enrollmentYear: 2026,
  isActive: true,
  ...over,
});

describe("GetStudent", () => {
  it("devuelve un estudiante de la institución", async () => {
    const students = new InMemoryStudents();
    students.items.push(baseStudent());
    const uc = new GetStudent(students);
    const r = await uc.execute({ actor: admin, studentId: "s-1" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.firstName1).toBe("ANA");
  });

  it("devuelve NOT_FOUND si el id no existe", async () => {
    const students = new InMemoryStudents();
    const uc = new GetStudent(students);
    const r = await uc.execute({ actor: admin, studentId: "fantasma" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const students = new InMemoryStudents();
    students.items.push(baseStudent());
    const uc = new GetStudent(students);
    const r = await uc.execute({ actor: teacher, studentId: "s-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("UpdateStudent", () => {
  let students: InMemoryStudents;
  let groups: InMemoryGroups;
  let uc: UpdateStudent;

  beforeEach(() => {
    students = new InMemoryStudents();
    groups = new InMemoryGroups([
      { id: "g1", institutionId: "i1", courseId: "c1", name: "11-03" },
      { id: "g-other", institutionId: "i2", courseId: "cx", name: "Fantasma" },
    ]);
    uc = new UpdateStudent(students, groups);
    students.items.push(baseStudent());
  });

  it("edita nombre + documento + estado", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "LÓPEZ",
        lastName2: "GARCÍA",
        firstName1: "ANA",
        firstName2: "MARÍA",
        idType: "C.C.",
        idNumber: "999",
        enrollmentYear: 2026,
        isActive: false,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lastName1).toBe("LÓPEZ");
      expect(r.value.lastName2).toBe("GARCÍA");
      expect(r.value.firstName1).toBe("ANA");
      expect(r.value.firstName2).toBe("MARÍA");
      expect(r.value.idNumber).toBe("999");
      expect(r.value.isActive).toBe(false);
      expect(r.value.code).toBe("EST-001"); // código intacto
    }
  });

  it("rechaza idType inválido", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "x",
        lastName2: "",
        firstName1: "x",
        firstName2: "",
        idType: "PASAPORTE",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza grupo de otra institución", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g-other",
        lastName1: "x",
        lastName2: "",
        firstName1: "x",
        firstName2: "",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza año de ingreso fuera de rango", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "x",
        lastName2: "",
        firstName1: "x",
        firstName2: "",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 1989,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza lastName1 vacío", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "  ",
        lastName2: "García",
        firstName1: "Ana",
        firstName2: "",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza firstName1 vacío", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "Pérez",
        lastName2: "",
        firstName1: "",
        firstName2: "María",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("acepta lastName2 y firstName2 vacíos", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "Pérez",
        lastName2: "",
        firstName1: "Ana",
        firstName2: "",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(true);
  });

  it("NOT_FOUND si el id no existe", async () => {
    const r = await uc.execute({
      actor: admin,
      studentId: "nope",
      data: {
        groupId: "g1",
        lastName1: "x",
        lastName2: "",
        firstName1: "x",
        firstName2: "",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const r = await uc.execute({
      actor: teacher,
      studentId: "s-1",
      data: {
        groupId: "g1",
        lastName1: "x",
        lastName2: "",
        firstName1: "x",
        firstName2: "",
        idType: "C.C.",
        idNumber: "1",
        enrollmentYear: 2026,
        isActive: true,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("DeleteStudent", () => {
  it("soft-delete baja isActive", async () => {
    const students = new InMemoryStudents();
    students.items.push(baseStudent());
    const uc = new DeleteStudent(students);

    const r = await uc.execute({ actor: admin, studentId: "s-1" });
    expect(r.ok).toBe(true);
    const still = await students.findById("i1", "s-1");
    expect(still?.isActive).toBe(false);
  });

  it("NOT_FOUND si el id no existe", async () => {
    const students = new InMemoryStudents();
    const uc = new DeleteStudent(students);
    const r = await uc.execute({ actor: admin, studentId: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const students = new InMemoryStudents();
    students.items.push(baseStudent());
    const uc = new DeleteStudent(students);
    const r = await uc.execute({ actor: teacher, studentId: "s-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
