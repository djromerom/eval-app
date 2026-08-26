import { beforeEach, describe, expect, it } from "vitest";
import {
  AssignLeader,
  ListLeaderAssignments,
  UnassignLeader,
} from "@/modules/leader-assignments/application/leader-assignments";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  LeaderAssignment,
  LeaderAssignmentRepository,
} from "@/modules/leader-assignments/domain/leader-assignment";
import type { Course, CourseRepository } from "@/modules/academic/domain/types";

class InMemoryLeaderAssignments implements LeaderAssignmentRepository {
  items: LeaderAssignment[] = [];
  async assign(userId: string, courseId: string): Promise<void> {
    if (!(await this.isAssigned(userId, courseId))) {
      this.items.push({
        id: `a-${this.items.length + 1}`,
        userId,
        courseId,
        courseName: courseId,
        userName: userId,
      });
    }
  }
  async unassign(userId: string, courseId: string): Promise<void> {
    this.items = this.items.filter((a) => !(a.userId === userId && a.courseId === courseId));
  }
  async isAssigned(userId: string, courseId: string): Promise<boolean> {
    return this.items.some((a) => a.userId === userId && a.courseId === courseId);
  }
  async listAssignments(institutionId: string, userId?: string): Promise<LeaderAssignment[]> {
    return this.items.filter((a) => (userId ? a.userId === userId : true));
  }
  async listAssignedCourseIds(_institutionId: string, userId: string): Promise<string[]> {
    return this.items.filter((a) => a.userId === userId).map((a) => a.courseId);
  }
}

class InMemoryCourses implements CourseRepository {
  constructor(private readonly items: Course[]) {}
  async findAll(_institutionId: string): Promise<Course[]> {
    return this.items;
  }
  async findById(_institutionId: string, id: string): Promise<Course | null> {
    return this.items.find((c) => c.id === id) ?? null;
  }
  async create(): Promise<Course> {
    throw new Error("no usado");
  }
}

const admin: AuthenticatedUser = {
  userId: "u-admin",
  institutionId: "i1",
  roles: ["ECU_MASTER"],
};
const leader1: AuthenticatedUser = {
  userId: "u-lider-1",
  institutionId: "i1",
  roles: ["ECU_LIDER"],
};
const teacher: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "i1",
  roles: ["TEACHER"],
};

const courses: Course[] = [
  { id: "c-8", name: "8°", code: "8", academicYearId: "ay1", institutionId: "i1" },
  { id: "c-9", name: "9°", code: "9", academicYearId: "ay1", institutionId: "i1" },
];

let assignments: InMemoryLeaderAssignments;
let courseRepo: InMemoryCourses;
let hasRoleResult = true; // toggled por test
const userHasEcuLiderRole = async (_i: string, userId: string): Promise<boolean> => {
  if (userId === "u-lider-1") return hasRoleResult;
  return false;
};

describe("AssignLeader", () => {
  beforeEach(() => {
    assignments = new InMemoryLeaderAssignments();
    courseRepo = new InMemoryCourses(courses);
    hasRoleResult = true;
  });

  it("asigna un líder a un курсо de la institución", async () => {
    const uc = new AssignLeader(assignments, courseRepo, userHasEcuLiderRole);
    const r = await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-8" });
    expect(r.ok).toBe(true);
    expect(await assignments.isAssigned("u-lider-1", "c-8")).toBe(true);
  });

  it("rechaza si el usuario no tiene rol ECU_LIDER", async () => {
    hasRoleResult = false;
    const uc = new AssignLeader(assignments, courseRepo, userHasEcuLiderRole);
    const r = await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-8" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza курсо inexistente", async () => {
    const uc = new AssignLeader(assignments, courseRepo, userHasEcuLiderRole);
    const r = await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-fake" });
    expect(r.ok).toBe(false);
  });

  it("rechaza duplicado", async () => {
    const uc = new AssignLeader(assignments, courseRepo, userHasEcuLiderRole);
    await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-8" });
    const r = await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-8" });
    expect(r.ok).toBe(false);
  });

  it("rechaza a un TEACHER (no es admin)", async () => {
    const uc = new AssignLeader(assignments, courseRepo, userHasEcuLiderRole);
    const r = await uc.execute({ actor: teacher, userId: "u-lider-1", courseId: "c-8" });
    expect(r.ok).toBe(false);
  });
});

describe("UnassignLeader", () => {
  beforeEach(() => {
    assignments = new InMemoryLeaderAssignments();
  });

  it("quita la asignación", async () => {
    await assignments.assign("u-lider-1", "c-8");
    const uc = new UnassignLeader(assignments);
    const r = await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-8" });
    expect(r.ok).toBe(true);
    expect(await assignments.isAssigned("u-lider-1", "c-8")).toBe(false);
  });

  it("es idempotente (no falla si no estaba)", async () => {
    const uc = new UnassignLeader(assignments);
    const r = await uc.execute({ actor: admin, userId: "u-lider-1", courseId: "c-8" });
    expect(r.ok).toBe(true);
  });
});

describe("ListLeaderAssignments (scope filter)", () => {
  beforeEach(() => {
    assignments = new InMemoryLeaderAssignments();
  });

  it("ECU_MASTER ve todas las asignaciones", async () => {
    await assignments.assign("u-lider-1", "c-8");
    await assignments.assign("u-lider-2", "c-9");
    const uc = new ListLeaderAssignments(assignments);
    const r = await uc.execute({ actor: admin });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it("ECU_LIDER ve solo las suyas, ignora el userId que se le pase", async () => {
    await assignments.assign("u-lider-1", "c-8");
    await assignments.assign("u-lider-2", "c-9");
    const uc = new ListLeaderAssignments(assignments);
    const r = await uc.execute({ actor: leader1, userId: "u-lider-2" });
    // El use case rechaza con FORBIDDEN (no devuelve la lista vacía) cuando
    // un líder intenta enumerar las asignaciones de otro. Más explícito
    // que devolver un subconjunto silencioso.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("ECU_LIDER ve las suyas cuando pasa su propio userId", async () => {
    await assignments.assign("u-lider-1", "c-8");
    await assignments.assign("u-lider-2", "c-9");
    const uc = new ListLeaderAssignments(assignments);
    const r = await uc.execute({ actor: leader1, userId: "u-lider-1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]!.userId).toBe("u-lider-1");
    }
  });

  it("listAssignedCourseIds devuelve solo los courseIds del líder", async () => {
    await assignments.assign("u-lider-1", "c-8");
    await assignments.assign("u-lider-1", "c-9");
    const ids = await assignments.listAssignedCourseIds("i1", "u-lider-1");
    expect(ids.sort()).toEqual(["c-8", "c-9"]);
  });
});