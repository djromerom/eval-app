import { beforeEach, describe, expect, it } from "vitest";
import {
  AssignTeacher,
  CompleteTeacherProfile,
  CreateTeacher,
  EnsureTeacherProfile,
  ResendTeacherInvitation,
} from "@/modules/teachers/application/teachers";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { Email, EmailService } from "@/shared/domain/email";
import {
  type CreateTeacherData,
  type Teacher,
  type TeacherAssignment,
  type TeacherProfileData,
  type TeacherRepository,
  isProfileComplete,
} from "@/modules/teachers/domain/teacher";
import type {
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
} from "@/modules/academic/domain/types";

class InMemoryTeachers implements TeacherRepository {
  items: Teacher[] = [];
  assignments: TeacherAssignment[] = [];
  async findAll(institutionId: string) {
    return this.items.filter((t) => t.institutionId === institutionId);
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((t) => t.institutionId === institutionId && t.id === id) ?? null;
  }
  async emailTaken(email: string) {
    return this.items.some((t) => t.email === email);
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
  tokens: { userId: string; tokenHash: string }[] = [];
  async setInviteToken(userId: string, tokenHash: string, _expiresAt: Date): Promise<void> {
    this.tokens.push({ userId, tokenHash });
  }
  activate(id: string) {
    const t = this.items.find((x) => x.id === id);
    if (t) t.isActive = true;
  }
  async assign(teacherId: string, courseSubjectId: string) {
    this.assignments.push({
      id: `a-${this.assignments.length + 1}`,
      teacherId,
      courseSubjectId,
      courseName: "11°",
      subjectName: "Mat",
    });
  }
  async isAssigned(teacherId: string, courseSubjectId: string) {
    return this.assignments.some(
      (a) => a.teacherId === teacherId && a.courseSubjectId === courseSubjectId,
    );
  }
  async listAssignments(institutionId: string, teacherId?: string) {
    return this.assignments.filter((a) => !teacherId || a.teacherId === teacherId);
  }
}

class InMemoryCourseSubjects implements CourseSubjectRepository {
  constructor(private readonly items: CourseSubject[]) {}
  async findAll(): Promise<CourseSubjectView[]> {
    return this.items.map((cs) => ({ ...cs, courseName: "11°", subjectName: "Mat" }));
  }
  async findById(_institutionId: string, id: string) {
    return this.items.find((cs) => cs.id === id) ?? null;
  }
  async exists() {
    return false;
  }
  async create(): Promise<CourseSubject> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    // no usado en este test
  }
}

const admin: AuthenticatedUser = { userId: "a", institutionId: "i1", roles: ["ECU_MASTER"] };
const institutionName = "Colegio Test";

describe("CreateTeacher", () => {
  let repo: InMemoryTeachers;
  let uc: CreateTeacher;
  beforeEach(() => {
    repo = new InMemoryTeachers();
    uc = new CreateTeacher(repo);
  });

  const data = (over: Partial<CreateTeacherData> = {}): CreateTeacherData => ({
    name: "Prof. Uno",
    email: "Prof@Colegio.edu.co",
    idType: "C.C.",
    idNumber: "999",
    ...over,
  });

  it("crea el docente con cuenta inactiva y email normalizado", async () => {
    const r = await uc.execute({ actor: admin, data: data(), institutionName });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("prof@colegio.edu.co");
      expect(r.value.isActive).toBe(false);
    }
  });

  it("rechaza un correo ya registrado (sin reventar la BD)", async () => {
    const first = await uc.execute({ actor: admin, data: data(), institutionName });
    expect(first.ok).toBe(true);
    const dup = await uc.execute({
      actor: admin,
      data: data({ email: "PROF@colegio.edu.co" }),
      institutionName,
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("VALIDATION");
  });

  it("rechaza tipo de documento inválido", async () => {
    const r = await uc.execute({ actor: admin, data: data({ idType: "T.I." }), institutionName });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza a un no-ADMIN", async () => {
    const r = await uc.execute({
      actor: { ...admin, roles: ["TEACHER"] },
      data: data(),
      institutionName,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

class FakeEmail implements EmailService {
  sent: Email[] = [];
  constructor(private readonly fails = false) {}
  async send(email: Email): Promise<void> {
    if (this.fails) throw new Error("SMTP caído");
    this.sent.push(email);
  }
}

describe("ResendTeacherInvitation", () => {
  let repo: InMemoryTeachers;
  beforeEach(async () => {
    repo = new InMemoryTeachers();
    await repo.createWithUser("i1", {
      name: "Prof. Uno",
      email: "prof@colegio.edu.co",
      idType: "C.C.",
      idNumber: "999",
    });
  });

  it("reenvía la invitación a un docente invitado (nuevo token + correo)", async () => {
    const email = new FakeEmail();
    const r = await new ResendTeacherInvitation(repo, email).execute({
      actor: admin,
      teacherId: "t-1",
      institutionName,
    });
    expect(r.ok).toBe(true);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe("prof@colegio.edu.co");
    // El enlace apunta a /accept-invite (el route group (auth) no va en la URL).
    expect(email.sent[0]?.html).toContain("/accept-invite?token=");
    expect(email.sent[0]?.html).not.toContain("/auth/accept-invite");
    expect(repo.tokens).toHaveLength(1);
  });

  it("falla si el SMTP no está configurado", async () => {
    const r = await new ResendTeacherInvitation(repo, undefined).execute({
      actor: admin,
      teacherId: "t-1",
      institutionName,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("falla si el docente ya activó su cuenta", async () => {
    repo.activate("t-1");
    const r = await new ResendTeacherInvitation(repo, new FakeEmail()).execute({
      actor: admin,
      teacherId: "t-1",
      institutionName,
    });
    expect(r.ok).toBe(false);
  });

  it("falla si el docente no existe", async () => {
    const r = await new ResendTeacherInvitation(repo, new FakeEmail()).execute({
      actor: admin,
      teacherId: "nope",
      institutionName,
    });
    expect(r.ok).toBe(false);
  });

  it("surfacea el error cuando el envío falla", async () => {
    const r = await new ResendTeacherInvitation(repo, new FakeEmail(true)).execute({
      actor: admin,
      teacherId: "t-1",
      institutionName,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/no se pudo enviar/i);
  });

  it("rechaza a un no-ADMIN", async () => {
    const r = await new ResendTeacherInvitation(repo, new FakeEmail()).execute({
      actor: { ...admin, roles: ["TEACHER"] },
      teacherId: "t-1",
      institutionName,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("EnsureTeacherProfile", () => {
  it("crea un perfil incompleto para un usuario con rol Profesor", async () => {
    const repo = new InMemoryTeachers();
    const r = await new EnsureTeacherProfile(repo).execute({ actor: admin, userId: "u-99" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(isProfileComplete(r.value)).toBe(false);
    expect(repo.items).toHaveLength(1);
  });

  it("es idempotente: no duplica si el perfil ya existe", async () => {
    const repo = new InMemoryTeachers();
    const teacher = await repo.createWithUser("i1", {
      name: "P",
      email: "p@c.co",
      idType: "C.C.",
      idNumber: "1",
    });
    const r = await new EnsureTeacherProfile(repo).execute({
      actor: admin,
      userId: teacher.userId,
    });
    expect(r.ok).toBe(true);
    expect(repo.items).toHaveLength(1);
  });

  it("rechaza a un no-ADMIN", async () => {
    const r = await new EnsureTeacherProfile(new InMemoryTeachers()).execute({
      actor: { ...admin, roles: ["TEACHER"] },
      userId: "u-1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("CompleteTeacherProfile", () => {
  it("completa el documento de un perfil incompleto", async () => {
    const repo = new InMemoryTeachers();
    const ensured = await new EnsureTeacherProfile(repo).execute({ actor: admin, userId: "u-1" });
    if (!ensured.ok) throw new Error("setup falló");
    const r = await new CompleteTeacherProfile(repo).execute({
      actor: admin,
      teacherId: ensured.value.id,
      idType: "C.C.",
      idNumber: "123",
      phone: "300",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(isProfileComplete(r.value)).toBe(true);
  });

  it("rechaza documento vacío", async () => {
    const repo = new InMemoryTeachers();
    const ensured = await new EnsureTeacherProfile(repo).execute({ actor: admin, userId: "u-1" });
    if (!ensured.ok) throw new Error("setup falló");
    const r = await new CompleteTeacherProfile(repo).execute({
      actor: admin,
      teacherId: ensured.value.id,
      idType: "C.C.",
      idNumber: "   ",
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza si el docente no existe", async () => {
    const r = await new CompleteTeacherProfile(new InMemoryTeachers()).execute({
      actor: admin,
      teacherId: "nope",
      idType: "C.C.",
      idNumber: "1",
    });
    expect(r.ok).toBe(false);
  });
});

describe("AssignTeacher", () => {
  it("asigna y evita duplicados; valida existencia", async () => {
    const repo = new InMemoryTeachers();
    const teacher = await repo.createWithUser("i1", {
      name: "P",
      email: "p@c.co",
      idType: "C.C.",
      idNumber: "1",
    });
    const cs = new InMemoryCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new AssignTeacher(repo, cs);

    const ok1 = await uc.execute({ actor: admin, teacherId: teacher.id, courseSubjectId: "cs1" });
    expect(ok1.ok).toBe(true);

    const dup = await uc.execute({ actor: admin, teacherId: teacher.id, courseSubjectId: "cs1" });
    expect(dup.ok).toBe(false);

    const badCs = await uc.execute({
      actor: admin,
      teacherId: teacher.id,
      courseSubjectId: "nope",
    });
    expect(badCs.ok).toBe(false);
  });
});
