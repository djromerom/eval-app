import { beforeEach, describe, expect, it } from "vitest";
import { CreateAcademicYear } from "@/modules/academic/application/academic-years";
import { CreateCourse } from "@/modules/academic/application/courses";
import { CreateSubject } from "@/modules/academic/application/subjects";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  AcademicYear,
  AcademicYearRepository,
  Course,
  CourseRepository,
  CreateAcademicYearData,
  CreateCourseData,
  CreateSubjectData,
  Subject,
  SubjectRepository,
} from "@/modules/academic/domain/types";

class InMemoryYears implements AcademicYearRepository {
  items: AcademicYear[] = [];
  async findAll(institutionId: string) {
    return this.items.filter((y) => y.institutionId === institutionId);
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((y) => y.institutionId === institutionId && y.id === id) ?? null;
  }
  async findByYear(institutionId: string, year: number) {
    return this.items.find((y) => y.institutionId === institutionId && y.year === year) ?? null;
  }
  async create(institutionId: string, data: CreateAcademicYearData) {
    const y: AcademicYear = {
      id: `y-${this.items.length + 1}`,
      institutionId,
      year: data.year,
      startDate: data.startDate,
      endDate: data.endDate,
      isCurrent: data.isCurrent ?? false,
    };
    this.items.push(y);
    return y;
  }
  async setCurrent(institutionId: string, id: string) {
    for (const y of this.items) {
      if (y.institutionId === institutionId) y.isCurrent = y.id === id;
    }
  }
}

class InMemoryCourses implements CourseRepository {
  items: Course[] = [];
  async findAll(institutionId: string, academicYearId?: string) {
    return this.items.filter(
      (c) =>
        c.institutionId === institutionId &&
        (!academicYearId || c.academicYearId === academicYearId),
    );
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((c) => c.institutionId === institutionId && c.id === id) ?? null;
  }
  async create(institutionId: string, data: CreateCourseData) {
    const c: Course = { id: `c-${this.items.length + 1}`, institutionId, ...data };
    this.items.push(c);
    return c;
  }
}

class InMemorySubjects implements SubjectRepository {
  items: Subject[] = [];
  async findAllForInstitution(institutionId: string) {
    return this.items.filter((s) => s.institutionId === institutionId || s.institutionId === null);
  }
  async findById(id: string) {
    return this.items.find((s) => s.id === id) ?? null;
  }
  async create(institutionId: string | null, data: CreateSubjectData) {
    const s: Subject = {
      id: `s-${this.items.length + 1}`,
      institutionId,
      name: data.name,
      code: data.code,
    };
    this.items.push(s);
    return s;
  }
}

const admin: AuthenticatedUser = { userId: "u", institutionId: "i1", roles: ["ECU_MASTER"] };
const teacher: AuthenticatedUser = { userId: "t", institutionId: "i1", roles: ["TEACHER"] };
const superAdmin: AuthenticatedUser = { userId: "s", institutionId: "i1", roles: ["SUPER_ADMIN"] };

describe("CreateAcademicYear", () => {
  let years: InMemoryYears;
  let uc: CreateAcademicYear;
  beforeEach(() => {
    years = new InMemoryYears();
    uc = new CreateAcademicYear(years);
  });

  const data = (over: Partial<CreateAcademicYearData> = {}): CreateAcademicYearData => ({
    year: 2026,
    startDate: new Date("2026-01-15"),
    endDate: new Date("2026-11-30"),
    ...over,
  });

  it("crea un año válido", async () => {
    const r = await uc.execute({ actor: admin, data: data() });
    expect(r.ok).toBe(true);
  });
  it("rechaza a un no-ADMIN", async () => {
    const r = await uc.execute({ actor: teacher, data: data() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
  it("rechaza rango de fechas inválido", async () => {
    const r = await uc.execute({ actor: admin, data: data({ startDate: new Date("2026-12-01") }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
  it("rechaza año duplicado", async () => {
    await uc.execute({ actor: admin, data: data() });
    const r = await uc.execute({ actor: admin, data: data() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
  it("marca como actual cuando isCurrent", async () => {
    const r = await uc.execute({ actor: admin, data: data({ isCurrent: true }) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.isCurrent).toBe(true);
  });
});

describe("CreateCourse", () => {
  it("rechaza si el año académico no existe en la institución", async () => {
    const years = new InMemoryYears();
    const courses = new InMemoryCourses();
    const uc = new CreateCourse(courses, years);
    const r = await uc.execute({
      actor: admin,
      data: { academicYearId: "inexistente", name: "11°", code: "G11" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
});

describe("CreateSubject", () => {
  it("un ADMIN crea asignatura de institución", async () => {
    const uc = new CreateSubject(new InMemorySubjects());
    const r = await uc.execute({ actor: admin, data: { name: "Física", code: "FIS" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.institutionId).toBe("i1");
  });
  it("crear global exige SUPER_ADMIN", async () => {
    const uc = new CreateSubject(new InMemorySubjects());
    const denied = await uc.execute({
      actor: admin,
      data: { name: "Global", code: "GLO", global: true },
    });
    expect(denied.ok).toBe(false);
    const okGlobal = await uc.execute({
      actor: superAdmin,
      data: { name: "Global", code: "GLO", global: true },
    });
    expect(okGlobal.ok).toBe(true);
    if (okGlobal.ok) expect(okGlobal.value.institutionId).toBeNull();
  });
});
