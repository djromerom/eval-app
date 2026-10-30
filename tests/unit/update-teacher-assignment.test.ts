/**
 * Tests de los use cases de edición y borrado de una asignación docente ↔
 * asignatura-grado (drawer de Docentes).
 *
 * `UpdateTeacherAssignment` (editar el tipo de cuadernillo):
 *   - scoping por rol: solo ECU_MASTER edita,
 *   - la asignación debe existir en la institución del actor,
 *   - el tipo debe existir en la institución,
 *   - el tipo debe ser de una Prueba del MISMO año académico que el grado,
 *   - no puede quedar duplicado (docente + asignatura-grado + tipo),
 *   - la asignación en curso no cuenta como duplicado consigo misma,
 *   - puede volver a "cualquier cuadernillo" (tipo null).
 *
 * `RemoveTeacherAssignment` (eliminar la asignación):
 *   - solo ECU_MASTER borra,
 *   - no borra asignaciones de otra institución.
 *
 * Todo con repos in-memory: sin BD.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  RemoveTeacherAssignment,
  UpdateTeacherAssignment,
} from "@/modules/teachers/application/teachers";
import type {
  Teacher,
  TeacherAssignment,
  TeacherRepository,
} from "@/modules/teachers/domain/teacher";
import type {
  Course,
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
  CourseRepository,
  Period,
  PeriodRepository,
} from "@/modules/academic/domain/types";
import type {
  BookletType,
  BookletTypeRepository,
} from "@/modules/booklet-types/domain/booklet-type";

const admin: AuthenticatedUser = { userId: "a", institutionId: "i1", roles: ["ECU_MASTER"] };
const teacher: AuthenticatedUser = { userId: "t", institutionId: "i1", roles: ["TEACHER"] };

function makeAssignment(over: Partial<TeacherAssignment> = {}): TeacherAssignment {
  return {
    id: "a-1",
    teacherId: "t-1",
    courseSubjectId: "cs-1",
    courseName: "11°",
    subjectName: "Matemáticas",
    bookletTypeId: null,
    bookletTypeName: null,
    periodName: null,
    academicYearId: "y1",
    ...over,
  };
}

class InMemoryTeachers implements TeacherRepository {
  items: Teacher[] = [];
  assignments: TeacherAssignment[] = [];
  /** Institución a la que pertenecen las asignaciones del fake. */
  institutionId = "i1";

  async findAll(): Promise<Teacher[]> {
    return this.items;
  }
  async findById(): Promise<Teacher | null> {
    return null;
  }
  async emailTaken(): Promise<boolean> {
    return false;
  }
  async idNumberTakenInInstitution(): Promise<boolean> {
    return false;
  }
  async findByUserId(): Promise<Teacher | null> {
    return null;
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
  async assign(): Promise<void> {
    /* no usado */
  }
  async isAssigned(
    teacherId: string,
    courseSubjectId: string,
    bookletTypeId: string | null,
    excludeAssignmentId?: string,
  ): Promise<boolean> {
    return this.assignments.some(
      (a) =>
        a.teacherId === teacherId &&
        a.courseSubjectId === courseSubjectId &&
        a.bookletTypeId === bookletTypeId &&
        a.id !== excludeAssignmentId,
    );
  }
  async findAssignmentById(institutionId: string, assignmentId: string) {
    if (institutionId !== this.institutionId) return null;
    return this.assignments.find((a) => a.id === assignmentId) ?? null;
  }
  async updateAssignmentType(
    _institutionId: string,
    assignmentId: string,
    bookletTypeId: string | null,
  ): Promise<void> {
    const a = this.assignments.find((x) => x.id === assignmentId);
    if (!a) throw new Error("no encontrado");
    a.bookletTypeId = bookletTypeId;
    a.bookletTypeName = bookletTypeId ? "Estándar" : null;
    a.periodName = bookletTypeId ? "I Periodo" : null;
  }
  async deleteAssignment(_institutionId: string, assignmentId: string): Promise<void> {
    if (this.institutionId !== _institutionId) return;
    this.assignments = this.assignments.filter((a) => a.id !== assignmentId);
  }
  async listAssignments(): Promise<TeacherAssignment[]> {
    return this.assignments;
  }
}

class InMemoryCourseSubjects implements CourseSubjectRepository {
  items: CourseSubject[] = [{ id: "cs-1", courseId: "c-1", subjectId: "s-1" }];
  async findAll(): Promise<CourseSubjectView[]> {
    return [];
  }
  async findById(_institutionId: string, id: string) {
    return this.items.find((cs) => cs.id === id) ?? null;
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

class InMemoryCourses implements CourseRepository {
  items: Course[] = [
    { id: "c-1", institutionId: "i1", academicYearId: "y1", name: "11°", code: "11" },
  ];
  async findAll(): Promise<Course[]> {
    return this.items;
  }
  async findById(_institutionId: string, id: string) {
    return this.items.find((c) => c.id === id) ?? null;
  }
  async create(): Promise<Course> {
    throw new Error("no usado");
  }
}

class InMemoryPeriods implements PeriodRepository {
  items: Period[] = [
    {
      id: "p-1",
      institutionId: "i1",
      academicYearId: "y1",
      name: "I Periodo",
      order: 1,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-03-31"),
      isCurrent: true,
    },
    {
      id: "p-2",
      institutionId: "i1",
      academicYearId: "y2",
      name: "I Periodo 2027",
      order: 1,
      startDate: new Date("2027-01-01"),
      endDate: new Date("2027-03-31"),
      isCurrent: false,
    },
  ];
  async findAll(): Promise<Period[]> {
    return this.items;
  }
  async findById(_institutionId: string, id: string) {
    return this.items.find((p) => p.id === id) ?? null;
  }
  async findByName(_institutionId: string, name: string) {
    return this.items.find((p) => p.name === name) ?? null;
  }
  async create(): Promise<Period> {
    throw new Error("no usado");
  }
  async update(): Promise<Period> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    /* no usado */
  }
  async setCurrent(): Promise<void> {
    /* no usado */
  }
  async findCurrent(_institutionId: string, academicYearId: string) {
    return this.items.find((p) => p.academicYearId === academicYearId && p.isCurrent) ?? null;
  }
}

class InMemoryBookletTypes implements BookletTypeRepository {
  items: BookletType[] = [
    {
      id: "bt-estandar",
      institutionId: "i1",
      periodId: "p-1",
      name: "Estándar",
      description: null,
      order: 1,
    },
    {
      id: "bt-otro-anio",
      institutionId: "i1",
      periodId: "p-2",
      name: "Estándar 2027",
      description: null,
      order: 1,
    },
  ];
  async findById(_institutionId: string, id: string) {
    return this.items.find((bt) => bt.id === id) ?? null;
  }
  async listByPeriod(): Promise<BookletType[]> {
    return this.items;
  }
  async listByInstitution(): Promise<BookletType[]> {
    return this.items;
  }
  async findByName(): Promise<BookletType[]> {
    return [];
  }
  async findByNameAndPeriod(): Promise<BookletType[]> {
    return [];
  }
  async create(): Promise<BookletType> {
    throw new Error("no usado");
  }
  async update(): Promise<BookletType> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    /* no usado */
  }
}

describe("UpdateTeacherAssignment", () => {
  let repo: InMemoryTeachers;
  let uc: UpdateTeacherAssignment;

  beforeEach(() => {
    repo = new InMemoryTeachers();
    repo.assignments = [makeAssignment()];
    uc = new UpdateTeacherAssignment(
      repo,
      new InMemoryCourseSubjects(),
      new InMemoryBookletTypes(),
      new InMemoryCourses(),
      new InMemoryPeriods(),
    );
  });

  it("cambia el tipo de cuadernillo de la asignación", async () => {
    const r = await uc.execute({
      actor: admin,
      assignmentId: "a-1",
      bookletTypeId: "bt-estandar",
    });
    expect(r.ok).toBe(true);
    expect(repo.assignments[0]!.bookletTypeId).toBe("bt-estandar");
  });

  it("puede devolver la asignación a 'cualquier cuadernillo' (null)", async () => {
    repo.assignments[0]!.bookletTypeId = "bt-estandar";
    const r = await uc.execute({ actor: admin, assignmentId: "a-1", bookletTypeId: null });
    expect(r.ok).toBe(true);
    expect(repo.assignments[0]!.bookletTypeId).toBeNull();
  });

  it("rechaza a un docente (solo ECU_MASTER edita)", async () => {
    const r = await uc.execute({
      actor: teacher,
      assignmentId: "a-1",
      bookletTypeId: "bt-estandar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(repo.assignments[0]!.bookletTypeId).toBeNull();
  });

  it("rechaza una asignación que no existe", async () => {
    const r = await uc.execute({
      actor: admin,
      assignmentId: "no-existe",
      bookletTypeId: "bt-estandar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza una asignación de otra institución (multi-tenancy)", async () => {
    repo.institutionId = "i2";
    const r = await uc.execute({
      actor: admin,
      assignmentId: "a-1",
      bookletTypeId: "bt-estandar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.assignments[0]!.bookletTypeId).toBeNull();
  });

  it("rechaza un tipo de cuadernillo que no existe en la institución", async () => {
    const r = await uc.execute({
      actor: admin,
      assignmentId: "a-1",
      bookletTypeId: "bt-fantasma",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.assignments[0]!.bookletTypeId).toBeNull();
  });

  it("rechaza un tipo de una Prueba de otro año académico", async () => {
    const r = await uc.execute({
      actor: admin,
      assignmentId: "a-1",
      bookletTypeId: "bt-otro-anio",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.assignments[0]!.bookletTypeId).toBeNull();
  });

  it("rechaza quedar duplicado con otra asignación del mismo tipo", async () => {
    repo.assignments.push(
      makeAssignment({ id: "a-2", bookletTypeId: "bt-estandar", bookletTypeName: "Estándar" }),
    );
    const r = await uc.execute({
      actor: admin,
      assignmentId: "a-1",
      bookletTypeId: "bt-estandar",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.assignments[0]!.bookletTypeId).toBeNull();
  });

  it("guardar el MISMO tipo que ya tenía no cuenta como duplicado", async () => {
    repo.assignments[0]!.bookletTypeId = "bt-estandar";
    repo.assignments[0]!.bookletTypeName = "Estándar";
    const r = await uc.execute({
      actor: admin,
      assignmentId: "a-1",
      bookletTypeId: "bt-estandar",
    });
    expect(r.ok).toBe(true);
  });
});

describe("RemoveTeacherAssignment", () => {
  let repo: InMemoryTeachers;
  let uc: RemoveTeacherAssignment;

  beforeEach(() => {
    repo = new InMemoryTeachers();
    repo.assignments = [makeAssignment()];
    uc = new RemoveTeacherAssignment(repo);
  });

  it("elimina la asignación", async () => {
    const r = await uc.execute({ actor: admin, assignmentId: "a-1" });
    expect(r.ok).toBe(true);
    expect(repo.assignments).toHaveLength(0);
  });

  it("rechaza a un docente (solo ECU_MASTER elimina)", async () => {
    const r = await uc.execute({ actor: teacher, assignmentId: "a-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(repo.assignments).toHaveLength(1);
  });

  it("rechaza una asignación que no existe", async () => {
    const r = await uc.execute({ actor: admin, assignmentId: "no-existe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.assignments).toHaveLength(1);
  });

  it("no elimina asignaciones de otra institución", async () => {
    repo.institutionId = "i2";
    const r = await uc.execute({ actor: admin, assignmentId: "a-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    expect(repo.assignments).toHaveLength(1);
  });
});
