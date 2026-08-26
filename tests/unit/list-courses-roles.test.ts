import { describe, expect, it } from "vitest";
import { ListCourses } from "@/modules/academic/application/courses";
import type { Course, CourseRepository } from "@/modules/academic/domain/types";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";

class InMemoryCourses implements CourseRepository {
  constructor(private readonly items: Course[]) {}
  async findAll(): Promise<Course[]> {
    return this.items.map((c) => ({ ...c }));
  }
  async findById(): Promise<Course | null> {
    return null;
  }
  async create(): Promise<Course> {
    throw new Error("no usado");
  }
}

const coursesFixture: Course[] = [
  { id: "c1", name: "11°", code: "11", institutionId: "i1", academicYearId: "ay1" },
  { id: "c2", name: "10°", code: "10", institutionId: "i1", academicYearId: "ay1" },
];

const adminActor: AuthenticatedUser = {
  userId: "u-admin",
  institutionId: "i1",
  roles: ["ECU_MASTER"],
};

const coordinatorActor: AuthenticatedUser = {
  userId: "u-coord",
  institutionId: "i1",
  roles: ["ECU_LIDER"],
};

const teacherActor: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "i1",
  roles: ["TEACHER"],
};

describe("ListCourses — roles permitidos (fix Asignaturas vacías en /teacher/evaluations)", () => {
  it("ECU_MASTER ve todos los cursos de su institución", async () => {
    const uc = new ListCourses(new InMemoryCourses(coursesFixture));
    const res = await uc.execute({ actor: adminActor });
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.length).toBe(2);
  });

  it("COORDINATOR puede listar cursos (metadata read-only)", async () => {
    const uc = new ListCourses(new InMemoryCourses(coursesFixture));
    const res = await uc.execute({ actor: coordinatorActor });
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.length).toBe(2);
  });

  it("TEACHER puede listar cursos (necesita academicYearId para preseleccionar Prueba actual)", async () => {
    // Sin este permiso, /teacher/evaluations recibía courses=[] y el filtro
    // client-side de Asignaturas filtraba 0 resultados (csYearMap[id] era
    // undefined).
    const uc = new ListCourses(new InMemoryCourses(coursesFixture));
    const res = await uc.execute({ actor: teacherActor });
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.length).toBe(2);
  });

  it("Respeta el filtro academicYearId para todos los roles", async () => {
    const uc = new ListCourses(new InMemoryCourses(coursesFixture));
    const res = await uc.execute({ actor: teacherActor, academicYearId: "ay1" });
    expect(res.ok).toBe(true);
    expect(res.ok && res.value.length).toBe(2);
  });
});
