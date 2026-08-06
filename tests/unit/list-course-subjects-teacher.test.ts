import { beforeEach, describe, expect, it } from "vitest";
import { ListCourseSubjects } from "@/modules/academic/application/course-subjects";
import type {
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
} from "@/modules/academic/domain/types";
import type {
  Teacher,
  TeacherAssignment,
  TeacherRepository,
} from "@/modules/teachers/domain/teacher";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";

// ===== In-memory doubles =====

class InMemoryCourseSubjects implements CourseSubjectRepository {
  constructor(private readonly items: CourseSubjectView[]) {}
  async findAll(): Promise<CourseSubjectView[]> {
    // Devolvemos una copia para evitar aliasing entre tests.
    return this.items.map((cs) => ({ ...cs }));
  }
  async findById(): Promise<CourseSubject | null> {
    return null;
  }
  async exists(): Promise<boolean> {
    return false;
  }
  async create(): Promise<CourseSubject> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    /* no usado */
  }
}

class InMemoryTeachers implements TeacherRepository {
  items: Teacher[] = [];
  assignments: TeacherAssignment[] = [];
  async findAll() {
    return [...this.items];
  }
  async findById() {
    return null;
  }
  async emailTaken() {
    return false;
  }
  async idNumberTakenInInstitution(): Promise<boolean> {
    return false;
  }
  async findByUserId(institutionId: string, userId: string) {
    return this.items.find((t) => t.institutionId === institutionId && t.userId === userId) ?? null;
  }
  async createProfileForUser(): Promise<Teacher> {
    throw new Error("no usado");
  }
  async updateProfile(): Promise<Teacher> {
    throw new Error("no usado");
  }
  async createWithUser(): Promise<Teacher> {
    throw new Error("no usado");
  }
  async setInviteToken(): Promise<void> {
    /* no usado */
  }
  async assign(teacherId: string, courseSubjectId: string): Promise<void> {
    this.assignments.push({
      id: `a-${this.assignments.length + 1}`,
      teacherId,
      courseSubjectId,
      courseName: "",
      subjectName: "",
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
  // Auxiliar para tests
  addTeacher(t: Teacher): void {
    this.items.push(t);
  }
}

// ===== Fixtures =====

const adminActor: AuthenticatedUser = {
  userId: "u-admin",
  institutionId: "i1",
  roles: ["ECU_MASTER"],
};

const teacherActor: AuthenticatedUser = {
  userId: "u-teacher-1",
  institutionId: "i1",
  roles: ["TEACHER"],
};

const otherTeacherActor: AuthenticatedUser = {
  userId: "u-teacher-2",
  institutionId: "i1",
  roles: ["TEACHER"],
};

const courseSubjectsFixture: CourseSubjectView[] = [
  { id: "cs-A", courseId: "c1", subjectId: "s1", courseName: "11°", subjectName: "Matemáticas" },
  { id: "cs-B", courseId: "c1", subjectId: "s2", courseName: "11°", subjectName: "Física" },
  { id: "cs-C", courseId: "c2", subjectId: "s1", courseName: "10°", subjectName: "Matemáticas" },
  { id: "cs-D", courseId: "c2", subjectId: "s3", courseName: "10°", subjectName: "Biología" },
];

// ===== Tests =====

describe("ListCourseSubjects — scoping por rol (fix asignaciones de docente)", () => {
  let courseSubjects: InMemoryCourseSubjects;
  let teachers: InMemoryTeachers;
  let uc: ListCourseSubjects;

  beforeEach(() => {
    courseSubjects = new InMemoryCourseSubjects(courseSubjectsFixture);
    teachers = new InMemoryTeachers();
    teachers.addTeacher({
      id: "t-1",
      userId: "u-teacher-1",
      institutionId: "i1",
      name: "Docente Uno",
      email: "uno@i1.edu.co",
      idType: "C.C.",
      idNumber: "100",
      phone: null,
      isActive: true,
    });
    teachers.addTeacher({
      id: "t-2",
      userId: "u-teacher-2",
      institutionId: "i1",
      name: "Docente Dos",
      email: "dos@i1.edu.co",
      idType: "C.C.",
      idNumber: "200",
      phone: null,
      isActive: true,
    });
    // Docente 1 asignado a cs-A (Matemáticas 11°) y cs-C (Matemáticas 10°).
    // Docente 2 asignado a cs-B (Física 11°). Quedan cs-D sin asignar.
    void teachers.assign("t-1", "cs-A");
    void teachers.assign("t-1", "cs-C");
    void teachers.assign("t-2", "cs-B");
    uc = new ListCourseSubjects(courseSubjects, teachers);
  });

  it("ECU_MASTER ve TODOS los course-subjects de la institución", async () => {
    const r = await uc.execute({ actor: adminActor });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(4);
    expect(r.value.map((cs) => cs.id).sort()).toEqual(["cs-A", "cs-B", "cs-C", "cs-D"]);
  });

  it("TEACHER solo ve los course-subjects a los que está asignado", async () => {
    const r = await uc.execute({ actor: teacherActor });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((cs) => cs.id).sort()).toEqual(["cs-A", "cs-C"]);
    // No debe filtrar los del otro docente ni los no asignados.
    expect(r.value.find((cs) => cs.id === "cs-B")).toBeUndefined();
    expect(r.value.find((cs) => cs.id === "cs-D")).toBeUndefined();
  });

  it("otro TEACHER solo ve los suyos (no leakage entre docentes)", async () => {
    const r = await uc.execute({ actor: otherTeacherActor });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((cs) => cs.id)).toEqual(["cs-B"]);
  });

  it("TEACHER sin asignaciones devuelve []", async () => {
    const ghostTeacher: AuthenticatedUser = {
      userId: "u-sin-asignar",
      institutionId: "i1",
      roles: ["TEACHER"],
    };
    const r = await uc.execute({ actor: ghostTeacher });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it("TEACHER sin perfil docente devuelve [] (no debería ver nada)", async () => {
    // Simulamos un usuario con rol TEACHER pero sin fila en `teachers`.
    const orphanTeacher: AuthenticatedUser = {
      userId: "u-orphan",
      institutionId: "i1",
      roles: ["TEACHER"],
    };
    const r = await uc.execute({ actor: orphanTeacher });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it("sin TeacherRepository inyectado, TEACHER recibe [] (defensa en profundidad)", async () => {
    const ucSinRepo = new ListCourseSubjects(courseSubjects);
    const r = await ucSinRepo.execute({ actor: teacherActor });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([]);
  });

  it("rechaza a un usuario sin roles autorizados", async () => {
    const stranger: AuthenticatedUser = {
      userId: "u-x",
      institutionId: "i1",
      roles: [],
    };
    const r = await uc.execute({ actor: stranger });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
