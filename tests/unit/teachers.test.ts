import { beforeEach, describe, expect, it } from "vitest";
import { AssignTeacher, CreateTeacher } from "@/modules/teachers/application/teachers";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateTeacherData,
  Teacher,
  TeacherAssignment,
  TeacherRepository,
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
  async setInviteToken(_userId: string, _tokenHash: string, _expiresAt: Date): Promise<void> {
    // no-op para tests
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
}

const admin: AuthenticatedUser = { userId: "a", institutionId: "i1", roles: ["ADMIN"] };
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
