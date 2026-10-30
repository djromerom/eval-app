import { beforeEach, describe, expect, it } from "vitest";
import { CreateTeacher, ImportTeachers } from "@/modules/teachers/application/teachers";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { Email, EmailService } from "@/shared/domain/email";
import type {
  CreateTeacherData,
  Teacher,
  TeacherAssignment,
  TeacherProfileData,
  TeacherRepository,
} from "@/modules/teachers/domain/teacher";

class InMemoryTeachers implements TeacherRepository {
  items: Teacher[] = [];
  assignments: TeacherAssignment[] = [];
  tokens: { userId: string; tokenHash: string }[] = [];
  async findAll(institutionId: string) {
    return this.items.filter((t) => t.institutionId === institutionId);
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((t) => t.institutionId === institutionId && t.id === id) ?? null;
  }
  async emailTaken(email: string) {
    return this.items.some((t) => t.email === email);
  }
  async idNumberTakenInInstitution(institutionId: string, idType: string, idNumber: string) {
    return this.items.some(
      (t) => t.institutionId === institutionId && t.idType === idType && t.idNumber === idNumber,
    );
  }
  async findByUserId(institutionId: string, userId: string) {
    return this.items.find((t) => t.institutionId === institutionId && t.userId === userId) ?? null;
  }
  async createProfileForUser(userId: string, data: TeacherProfileData) {
    const t: Teacher = {
      id: `t-${this.items.length + 1}`,
      userId,
      institutionId: "i1",
      name: "Usuario",
      email: `${userId}@c.co`,
      idType: data.idType,
      idNumber: data.idNumber,
      phone: data.phone,
      isActive: false,
    };
    this.items.push(t);
    return t;
  }
  async updateProfile(teacherId: string, data: TeacherProfileData) {
    const t = this.items.find((x) => x.id === teacherId);
    if (!t) throw new Error("no encontrado");
    Object.assign(t, data);
    return t;
  }
  async createWithUser(institutionId: string, data: CreateTeacherData) {
    const t: Teacher = {
      id: `t-${this.items.length + 1}`,
      userId: `u-${this.items.length + 1}`,
      institutionId,
      name: data.name,
      email: data.email,
      idType: data.idType,
      idNumber: data.idNumber,
      phone: data.phone ?? null,
      isActive: false,
    };
    this.items.push(t);
    return t;
  }
  async setInviteToken(userId: string, tokenHash: string, _expiresAt: Date): Promise<void> {
    this.tokens.push({ userId, tokenHash });
  }
  async assign(teacherId: string, courseSubjectId: string, bookletTypeId: string | null) {
    this.assignments.push({
      id: `a-${this.assignments.length + 1}`,
      teacherId,
      courseSubjectId,
      courseName: "11°",
      subjectName: "Mat",
      bookletTypeId,
      bookletTypeName: null,
      periodName: null,
      academicYearId: "y1",
    });
  }
  async isAssigned(
    teacherId: string,
    courseSubjectId: string,
    bookletTypeId: string | null,
    excludeAssignmentId?: string,
  ) {
    return this.assignments.some(
      (a) =>
        a.teacherId === teacherId &&
        a.courseSubjectId === courseSubjectId &&
        a.bookletTypeId === bookletTypeId &&
        a.id !== excludeAssignmentId,
    );
  }
  async findAssignmentById(_institutionId: string, assignmentId: string) {
    return this.assignments.find((a) => a.id === assignmentId) ?? null;
  }
  async updateAssignmentType(
    _institutionId: string,
    assignmentId: string,
    bookletTypeId: string | null,
  ) {
    const a = this.assignments.find((x) => x.id === assignmentId);
    if (!a) throw new Error("no encontrado");
    a.bookletTypeId = bookletTypeId;
  }
  async deleteAssignment(institutionId: string, assignmentId: string) {
    if (institutionId !== "i1") return;
    this.assignments = this.assignments.filter((a) => a.id !== assignmentId);
  }
  async listAssignments(institutionId: string, teacherId?: string) {
    return this.assignments.filter((a) => !teacherId || a.teacherId === teacherId);
  }
}

class FakeEmail implements EmailService {
  sent: Email[] = [];
  constructor(private readonly fails = false) {}
  async send(email: Email): Promise<void> {
    if (this.fails) throw new Error("SMTP caído");
    this.sent.push(email);
  }
}

const admin: AuthenticatedUser = { userId: "a", institutionId: "i1", roles: ["ECU_MASTER"] };
const institutionName = "Colegio Test";

describe("ImportTeachers", () => {
  let repo: InMemoryTeachers;
  let email: FakeEmail;
  let uc: ImportTeachers;

  beforeEach(() => {
    repo = new InMemoryTeachers();
    email = new FakeEmail();
    const createTeacher = new CreateTeacher(repo, email);
    uc = new ImportTeachers(repo, createTeacher);
  });

  const validRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `Docente ${i + 1}`,
      email: `docente${i + 1}@colegio.edu.co`,
      idType: "C.C.",
      idNumber: `1000${i + 1}`,
      phone: `300000${(i + 1).toString().padStart(4, "0")}`,
    }));

  it("importa filas válidas y envía una invitación por cada una", async () => {
    const r = await uc.execute({
      actor: admin,
      rows: validRows(3),
      institutionName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(3);
    expect(r.value.failed).toBe(0);
    expect(r.value.errors).toEqual([]);
    expect(repo.items).toHaveLength(3);
    expect(email.sent).toHaveLength(3);
    expect(repo.tokens).toHaveLength(3);
    expect(email.sent.every((m) => m.html.includes("/accept-invite?token="))).toBe(true);
  });

  it("reporta errores por fila sin abortar las válidas", async () => {
    const rows = [
      { name: "Ana Pérez", email: "ana@c.co", idType: "C.C.", idNumber: "1" },
      { name: "Sin Email", email: "no-es-correo", idType: "C.C.", idNumber: "2" },
      { name: "Tipo Malo", email: "b@c.co", idType: "PP", idNumber: "3" },
      { name: "Doc Vacio", email: "c@c.co", idType: "C.C.", idNumber: "" },
    ];
    const r = await uc.execute({ actor: admin, rows, institutionName });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(1);
    expect(r.value.failed).toBe(3);
    expect(r.value.errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(r.value.errors[0]?.message).toMatch(/correo/i);
    expect(r.value.errors[1]?.message).toMatch(/tipo de documento/i);
    expect(r.value.errors[2]?.message).toMatch(/número de documento/i);
  });

  it("detecta duplicados internos de email y de documento", async () => {
    const rows = [
      { name: "A", email: "dup@c.co", idType: "C.C.", idNumber: "1" },
      { name: "B", email: "dup@c.co", idType: "C.C.", idNumber: "2" },
      { name: "C", email: "otro@c.co", idType: "C.C.", idNumber: "1" },
    ];
    const r = await uc.execute({ actor: admin, rows, institutionName });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(1);
    expect(r.value.failed).toBe(2);
    expect(r.value.errors[0]?.message).toMatch(/correo duplicado/i);
    expect(r.value.errors[1]?.message).toMatch(/documento duplicado/i);
  });

  it("rechaza email que ya existe en DB", async () => {
    await repo.createWithUser("i1", {
      name: "Previo",
      email: "previo@c.co",
      idType: "C.C.",
      idNumber: "999",
    });
    const r = await uc.execute({
      actor: admin,
      rows: [{ name: "Nuevo", email: "previo@c.co", idType: "C.C.", idNumber: "10" }],
      institutionName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(0);
    expect(r.value.errors[0]?.message).toMatch(/ya existe un usuario con el correo/i);
  });

  it("rechaza documento que ya existe en la misma institución", async () => {
    await repo.createWithUser("i1", {
      name: "Previo",
      email: "previo@c.co",
      idType: "C.C.",
      idNumber: "123456",
    });
    const r = await uc.execute({
      actor: admin,
      rows: [{ name: "Nuevo", email: "nuevo@c.co", idType: "C.C.", idNumber: "123456" }],
      institutionName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(0);
    expect(r.value.errors[0]?.message).toMatch(/ya existe un docente con C\.C\. 123456/i);
  });

  it("permite el mismo número de documento en otra institución (multi-tenancy)", async () => {
    await repo.createWithUser("i1", {
      name: "De i1",
      email: "i1@c.co",
      idType: "C.C.",
      idNumber: "123456",
    });
    const r = await uc.execute({
      actor: { ...admin, institutionId: "i2" },
      rows: [{ name: "De i2", email: "i2@c.co", idType: "C.C.", idNumber: "123456" }],
      institutionName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(1);
  });

  it("cap de errores: 50 en errors[] pero failed refleja el total real", async () => {
    const rows = Array.from({ length: 60 }, () => ({
      name: "",
      email: "x@c.co",
      idType: "C.C.",
      idNumber: "1",
    }));
    const r = await uc.execute({ actor: admin, rows, institutionName });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(0);
    expect(r.value.failed).toBe(60);
    expect(r.value.errors).toHaveLength(50);
  });

  it("best-effort email: si SMTP falla, las filas se crean igual", async () => {
    email = new FakeEmail(true);
    const createTeacher = new CreateTeacher(repo, email);
    uc = new ImportTeachers(repo, createTeacher);

    const r = await uc.execute({
      actor: admin,
      rows: validRows(2),
      institutionName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(2);
    expect(email.sent).toHaveLength(0);
    expect(repo.items).toHaveLength(2);
  });

  it("rechaza a un actor que no sea ECU_MASTER", async () => {
    const r = await uc.execute({
      actor: { ...admin, roles: ["TEACHER"] },
      rows: validRows(1),
      institutionName,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(repo.items).toHaveLength(0);
  });

  it("el reporte de error row numera desde 2 (encabezado en fila 1)", async () => {
    const r = await uc.execute({
      actor: admin,
      rows: [
        { name: "", email: "x@c.co", idType: "C.C.", idNumber: "1" }, // fila 2
        {
          name: "válido",
          email: "v@c.co",
          idType: "C.C.",
          idNumber: "2",
        }, // fila 3
        { name: "", email: "y@c.co", idType: "C.C.", idNumber: "3" }, // fila 4
      ],
      institutionName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.errors.map((e) => e.row)).toEqual([2, 4]);
    expect(r.value.created).toBe(1);
  });
});
