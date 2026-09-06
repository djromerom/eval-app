import { beforeEach, describe, expect, it } from "vitest";
import { CreateAcademicYear } from "@/modules/academic/application/academic-years";
import { DeleteCourseSubject } from "@/modules/academic/application/course-subjects";
import { CreateCourse } from "@/modules/academic/application/courses";
import { CreateGroup, DeleteGroup } from "@/modules/academic/application/groups";
import {
  CreatePeriod,
  DeletePeriod,
  GetPeriod,
  SetCurrentPeriod,
  UpdatePeriod,
} from "@/modules/academic/application/periods";
import { CreateSubject } from "@/modules/academic/application/subjects";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  AcademicYear,
  AcademicYearRepository,
  Course,
  CourseRepository,
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
  CreateAcademicYearData,
  CreateCourseData,
  CreateCourseSubjectData,
  CreateGroupData,
  CreatePeriodData,
  CreateSubjectData,
  Group,
  GroupRepository,
  Period,
  PeriodRepository,
  Subject,
  SubjectRepository,
  UpdatePeriodData,
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
  async findCurrent(institutionId: string) {
    return this.items.find((y) => y.institutionId === institutionId && y.isCurrent) ?? null;
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

class InMemoryGroups implements GroupRepository {
  items: Group[] = [];
  async findAll(institutionId: string, courseId?: string) {
    return this.items.filter(
      (g) => g.institutionId === institutionId && (!courseId || g.courseId === courseId),
    );
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((g) => g.institutionId === institutionId && g.id === id) ?? null;
  }
  async create(institutionId: string, data: CreateGroupData) {
    const g: Group = { id: `g-${this.items.length + 1}`, institutionId, ...data };
    this.items.push(g);
    return g;
  }
  async delete(institutionId: string, id: string): Promise<void> {
    const idx = this.items.findIndex((g) => g.institutionId === institutionId && g.id === id);
    if (idx < 0) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    this.items.splice(idx, 1);
  }
}

class InMemoryCourseSubjects implements CourseSubjectRepository {
  items: CourseSubjectView[] = [];
  async findAll(institutionId: string): Promise<CourseSubjectView[]> {
    return this.items.filter((cs) => cs.courseId); // filtro real por institución lo hace el join en Prisma; en memoria asumimos que el caller ya filtró.
  }
  async findById(_institutionId: string, id: string): Promise<CourseSubject | null> {
    const target = this.items.find((cs) => cs.id === id);
    if (!target) return null;
    return { id: target.id, courseId: target.courseId, subjectId: target.subjectId };
  }
  async exists(courseId: string, subjectId: string): Promise<boolean> {
    return this.items.some((cs) => cs.courseId === courseId && cs.subjectId === subjectId);
  }
  async create(data: CreateCourseSubjectData): Promise<CourseSubject> {
    const id = `cs-${this.items.length + 1}`;
    this.items.push({ id, ...data, courseName: "?", subjectName: "?" });
    return { id, ...data };
  }
  async delete(courseId: string, subjectId: string): Promise<void> {
    const idx = this.items.findIndex(
      (cs) => cs.courseId === courseId && cs.subjectId === subjectId,
    );
    if (idx < 0) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    this.items.splice(idx, 1);
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

class InMemoryPeriods implements PeriodRepository {
  items: Period[] = [];
  async findAll(institutionId: string, academicYearId?: string) {
    return this.items.filter(
      (p) =>
        p.institutionId === institutionId &&
        (!academicYearId || p.academicYearId === academicYearId),
    );
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  /** Lanza P2002 cuando el nombre ya existe (simula Prisma). */
  async create(institutionId: string, data: CreatePeriodData) {
    const dup = this.items.find(
      (p) =>
        p.institutionId === institutionId &&
        p.academicYearId === data.academicYearId &&
        p.name === data.name,
    );
    if (dup) {
      const err = new Error("Unique constraint") as Error & { code: string };
      err.code = "P2002";
      throw err;
    }
    const p: Period = {
      id: `p-${this.items.length + 1}`,
      institutionId,
      ...data,
      isCurrent: false,
    };
    this.items.push(p);
    return p;
  }
  async update(institutionId: string, id: string, data: UpdatePeriodData) {
    const idx = this.items.findIndex((p) => p.institutionId === institutionId && p.id === id);
    if (idx < 0) return null;
    const current = this.items[idx]!;
    if (data.name !== undefined && data.name !== current.name) {
      const dup = this.items.find(
        (p) =>
          p.institutionId === institutionId &&
          p.academicYearId === current.academicYearId &&
          p.id !== id &&
          p.name === data.name,
      );
      if (dup) {
        const err = new Error("Unique constraint") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
    }
    const next: Period = {
      ...current,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
      ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
    };
    this.items[idx] = next;
    return next;
  }
  async delete(institutionId: string, id: string) {
    const idx = this.items.findIndex((p) => p.institutionId === institutionId && p.id === id);
    if (idx < 0) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    this.items.splice(idx, 1);
  }
  async setCurrent(
    institutionId: string,
    academicYearId: string,
    periodId: string,
    isCurrent: boolean,
  ) {
    if (isCurrent) {
      // Flip atómico (mismo algoritmo que PrismaPeriodRepository).
      for (const p of this.items) {
        if (
          p.institutionId === institutionId &&
          p.academicYearId === academicYearId &&
          p.id !== periodId
        ) {
          p.isCurrent = false;
        }
      }
      const target = this.items.find((p) => p.institutionId === institutionId && p.id === periodId);
      if (target) target.isCurrent = true;
      return;
    }
    const target = this.items.find((p) => p.institutionId === institutionId && p.id === periodId);
    if (target) target.isCurrent = false;
  }
  async findCurrent(institutionId: string, academicYearId: string) {
    return (
      this.items.find(
        (p) =>
          p.institutionId === institutionId &&
          p.academicYearId === academicYearId &&
          p.isCurrent,
      ) ?? null
    );
  }
}

describe("CreatePeriod", () => {
  let years: InMemoryYears;
  let periods: InMemoryPeriods;
  let uc: CreatePeriod;
  beforeEach(() => {
    years = new InMemoryYears();
    periods = new InMemoryPeriods();
    uc = new CreatePeriod(periods, years);
  });

  const seedYear = async () => {
    const r = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!r.ok) throw new Error("seed falló");
    return r.value.id;
  };

  const dataFor = (yearId: string, over: Partial<CreatePeriodData> = {}): CreatePeriodData => ({
    academicYearId: yearId,
    name: "I Periodo",
    order: 1,
    startDate: new Date("2026-01-15"),
    endDate: new Date("2026-06-30"),
    ...over,
  });

  it("crea un periodo válido", async () => {
    const yearId = await seedYear();
    const r = await uc.execute({ actor: admin, data: dataFor(yearId) });
    expect(r.ok).toBe(true);
  });

  it("rechaza nombre duplicado con CONFLICT (no escapa el P2002)", async () => {
    const yearId = await seedYear();
    const first = await uc.execute({ actor: admin, data: dataFor(yearId) });
    expect(first.ok).toBe(true);

    const second = await uc.execute({
      actor: admin,
      data: dataFor(yearId, { order: 2 }),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("CONFLICT");
      expect(second.error.message).toMatch(/Ya existe un periodo llamado "I Periodo"/);
    }
  });

  it("permite el mismo nombre en OTRO año académico", async () => {
    const yearId = await seedYear();
    const r1 = await uc.execute({ actor: admin, data: dataFor(yearId) });
    expect(r1.ok).toBe(true);

    // Crea un segundo año académico y vuelve a intentar el mismo nombre.
    const year2 = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2027,
        startDate: new Date("2027-01-15"),
        endDate: new Date("2027-11-30"),
      },
    });
    if (!year2.ok) throw new Error("seed año 2 falló");
    const r2 = await uc.execute({ actor: admin, data: dataFor(year2.value.id) });
    expect(r2.ok).toBe(true);
  });
});

describe("UpdatePeriod", () => {
  let years: InMemoryYears;
  let periods: InMemoryPeriods;
  let uc: UpdatePeriod;
  let seedPeriod: (over?: Partial<CreatePeriodData>) => Promise<string>;
  beforeEach(() => {
    years = new InMemoryYears();
    periods = new InMemoryPeriods();
    uc = new UpdatePeriod(periods, years);
    seedPeriod = async (over = {}) => {
      const y = await new CreateAcademicYear(years).execute({
        actor: admin,
        data: {
          year: 2026,
          startDate: new Date("2026-01-15"),
          endDate: new Date("2026-11-30"),
        },
      });
      if (!y.ok) throw new Error("seed año falló");
      const p = await new CreatePeriod(periods, years).execute({
        actor: admin,
        data: {
          academicYearId: y.value.id,
          name: "I Periodo",
          order: 1,
          startDate: new Date("2026-01-15"),
          endDate: new Date("2026-06-30"),
          ...over,
        },
      });
      if (!p.ok) throw new Error("seed periodo falló");
      return p.value.id;
    };
  });

  it("actualiza el nombre sin chocar contra sí mismo", async () => {
    const id = await seedPeriod();
    const r = await uc.execute({
      actor: admin,
      periodId: id,
      data: { name: "I Periodo" },
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza nombre duplicado con CONFLICT (incluido P2002 del repo)", async () => {
    const y = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!y.ok) throw new Error("seed año falló");
    const yId = y.value.id;
    await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: yId,
        name: "I Periodo",
        order: 1,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-06-30"),
      },
    });
    const segundo = await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: yId,
        name: "II Periodo",
        order: 2,
        startDate: new Date("2026-07-01"),
        endDate: new Date("2026-12-31"),
      },
    });
    if (!segundo.ok) throw new Error("seed II falló");

    const r = await uc.execute({
      actor: admin,
      periodId: segundo.value.id,
      data: { name: "I Periodo" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("rechaza orden no entero positivo", async () => {
    const id = await seedPeriod();
    const r = await uc.execute({ actor: admin, periodId: id, data: { order: 0 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza rango de fechas inválido (solo cambias end)", async () => {
    const id = await seedPeriod();
    const r = await uc.execute({
      actor: admin,
      periodId: id,
      data: { endDate: new Date("2025-01-01") },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza si el periodo no existe", async () => {
    const r = await uc.execute({
      actor: admin,
      periodId: "no-existe",
      data: { name: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const id = await seedPeriod();
    const r = await uc.execute({
      actor: teacher,
      periodId: id,
      data: { name: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("DeletePeriod", () => {
  let years: InMemoryYears;
  let periods: InMemoryPeriods;
  let uc: DeletePeriod;
  beforeEach(() => {
    years = new InMemoryYears();
    periods = new InMemoryPeriods();
    uc = new DeletePeriod(periods);
  });

  it("elimina un periodo existente", async () => {
    const y = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!y.ok) throw new Error("seed año falló");
    const p = await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: y.value.id,
        name: "I Periodo",
        order: 1,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-06-30"),
      },
    });
    if (!p.ok) throw new Error("seed periodo falló");

    const r = await uc.execute({ actor: admin, periodId: p.value.id });
    expect(r.ok).toBe(true);
    const still = await periods.findById(admin.institutionId, p.value.id);
    expect(still).toBeNull();
  });

  it("rechaza si el periodo no existe", async () => {
    const r = await uc.execute({ actor: admin, periodId: "no-existe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const r = await uc.execute({ actor: teacher, periodId: "cualquiera" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("GetPeriod", () => {
  it("devuelve un periodo existente", async () => {
    const years = new InMemoryYears();
    const periods = new InMemoryPeriods();
    const y = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!y.ok) throw new Error("seed año falló");
    const p = await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: y.value.id,
        name: "I Periodo",
        order: 1,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-06-30"),
      },
    });
    if (!p.ok) throw new Error("seed periodo falló");

    const uc = new GetPeriod(periods);
    const r = await uc.execute({ actor: admin, periodId: p.value.id });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("I Periodo");
  });

  it("devuelve NOT_FOUND si no existe", async () => {
    const periods = new InMemoryPeriods();
    const uc = new GetPeriod(periods);
    const r = await uc.execute({ actor: admin, periodId: "fantasma" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("permite lectura a TEACHER (no solo ECU_MASTER)", async () => {
    const years = new InMemoryYears();
    const periods = new InMemoryPeriods();
    const y = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!y.ok) throw new Error("seed año falló");
    const p = await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: y.value.id,
        name: "I Periodo",
        order: 1,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-06-30"),
      },
    });
    if (!p.ok) throw new Error("seed periodo falló");

    const uc = new GetPeriod(periods);
    const r = await uc.execute({ actor: teacher, periodId: p.value.id });
    expect(r.ok).toBe(true);
  });
});

// ===== DeleteGroup (Fase 11 — card del curso) =====

describe("DeleteGroup", () => {
  let groups: InMemoryGroups;
  let courses: InMemoryCourses;
  let years: InMemoryYears;
  let uc: DeleteGroup;
  beforeEach(() => {
    groups = new InMemoryGroups();
    courses = new InMemoryCourses();
    years = new InMemoryYears();
    uc = new DeleteGroup(groups);
  });

  it("elimina un grupo existente", async () => {
    const y = await years.create(admin.institutionId, {
      year: 2026,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    });
    const c = await new CreateCourse(courses, years).execute({
      actor: admin,
      data: { academicYearId: y.id, name: "11°", code: "G11" },
    });
    if (!c.ok) throw new Error("seed curso falló");

    const g = await new CreateGroup(groups, courses).execute({
      actor: admin,
      data: { courseId: c.value.id, name: "11-03" },
    });
    if (!g.ok) throw new Error("seed grupo falló");

    const r = await uc.execute({ actor: admin, groupId: g.value.id });
    expect(r.ok).toBe(true);
    const still = await groups.findById(admin.institutionId, g.value.id);
    expect(still).toBeNull();
  });

  it("rechaza si el grupo no existe", async () => {
    const r = await uc.execute({ actor: admin, groupId: "fantasma" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const r = await uc.execute({ actor: teacher, groupId: "cualquiera" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

// ===== DeleteCourseSubject (Fase 11 — card del curso) =====

describe("DeleteCourseSubject", () => {
  let courseSubjects: InMemoryCourseSubjects;
  let courses: InMemoryCourses;
  let years: InMemoryYears;
  let uc: DeleteCourseSubject;
  beforeEach(() => {
    courseSubjects = new InMemoryCourseSubjects();
    courses = new InMemoryCourses();
    years = new InMemoryYears();
    uc = new DeleteCourseSubject(courseSubjects, courses);
  });

  it("desenlaza una asignatura de un curso", async () => {
    const y = await years.create(admin.institutionId, {
      year: 2026,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    });
    const c = await new CreateCourse(courses, years).execute({
      actor: admin,
      data: { academicYearId: y.id, name: "11°", code: "G11" },
    });
    if (!c.ok) throw new Error("seed curso falló");

    const cs = await courseSubjects.create({
      courseId: c.value.id,
      subjectId: "sub-1",
    });

    const r = await uc.execute({ actor: admin, courseSubjectId: cs.id });
    expect(r.ok).toBe(true);
    const still = await courseSubjects.exists(c.value.id, "sub-1");
    expect(still).toBe(false);
  });

  it("rechaza si el enlace no existe", async () => {
    const r = await uc.execute({ actor: admin, courseSubjectId: "fantasma" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const r = await uc.execute({ actor: teacher, courseSubjectId: "cualquiera" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("SetCurrentPeriod", () => {
  let years: InMemoryYears;
  let periods: InMemoryPeriods;
  let uc: SetCurrentPeriod;
  beforeEach(() => {
    years = new InMemoryYears();
    periods = new InMemoryPeriods();
    uc = new SetCurrentPeriod(periods);
  });

  /**
   * Siembra: año académico + 3 periodos (I, II, III) del mismo año.
   * Devuelve sus IDs.
   */
  const seedYearAnd3Periods = async () => {
    const y = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!y.ok) throw new Error("seed año falló");
    const make = async (name: string, order: number): Promise<string> => {
      const p = await new CreatePeriod(periods, years).execute({
        actor: admin,
        data: {
          academicYearId: y.value.id,
          name,
          order,
          startDate: new Date("2026-01-15"),
          endDate: new Date("2026-11-30"),
        },
      });
      if (!p.ok) throw new Error("seed periodo falló");
      return p.value.id;
    };
    return {
      yearId: y.value.id,
      p1: await make("I Periodo", 1),
      p2: await make("II Periodo", 2),
      p3: await make("III Periodo", 3),
    };
  };

  it("marca una Prueba como actual", async () => {
    const { p2 } = await seedYearAnd3Periods();
    const r = await uc.execute({ actor: admin, periodId: p2, isCurrent: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.isCurrent).toBe(true);
    const stored = await periods.findById("i1", p2);
    expect(stored?.isCurrent).toBe(true);
  });

  it("desmarca las demás pruebas del mismo año académico", async () => {
    const { p1, p2, p3 } = await seedYearAnd3Periods();
    await uc.execute({ actor: admin, periodId: p2, isCurrent: true });
    expect((await periods.findById("i1", p1))?.isCurrent).toBe(false);
    expect((await periods.findById("i1", p2))?.isCurrent).toBe(true);
    expect((await periods.findById("i1", p3))?.isCurrent).toBe(false);
  });

  it("re-marca otra Prueba del mismo año: solo una queda como actual", async () => {
    const { p1, p2, p3 } = await seedYearAnd3Periods();
    await uc.execute({ actor: admin, periodId: p1, isCurrent: true });
    await uc.execute({ actor: admin, periodId: p3, isCurrent: true });
    expect((await periods.findById("i1", p1))?.isCurrent).toBe(false);
    expect((await periods.findById("i1", p2))?.isCurrent).toBe(false);
    expect((await periods.findById("i1", p3))?.isCurrent).toBe(true);
  });

  it("solo afecta el año académico indicado (aisla entre años)", async () => {
    // Sembramos dos años con sus respectivas pruebas y las marcamos.
    const y1 = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2026,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!y1.ok) throw new Error("seed y1 falló");
    const y2 = await new CreateAcademicYear(years).execute({
      actor: admin,
      data: {
        year: 2027,
        startDate: new Date("2027-01-15"),
        endDate: new Date("2027-11-30"),
      },
    });
    if (!y2.ok) throw new Error("seed y2 falló");
    const p1 = await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: y1.value.id,
        name: "I Periodo",
        order: 1,
        startDate: new Date("2026-01-15"),
        endDate: new Date("2026-11-30"),
      },
    });
    if (!p1.ok) throw new Error("seed p1 falló");
    const p2 = await new CreatePeriod(periods, years).execute({
      actor: admin,
      data: {
        academicYearId: y2.value.id,
        name: "I Periodo",
        order: 1,
        startDate: new Date("2027-01-15"),
        endDate: new Date("2027-11-30"),
      },
    });
    if (!p2.ok) throw new Error("seed p2 falló");

    await uc.execute({ actor: admin, periodId: p1.value.id, isCurrent: true });
    await uc.execute({ actor: admin, periodId: p2.value.id, isCurrent: true });

    expect((await periods.findById("i1", p1.value.id))?.isCurrent).toBe(true);
    expect((await periods.findById("i1", p2.value.id))?.isCurrent).toBe(true);
  });

  it("desmarcar (isCurrent=false) no toca las demás", async () => {
    const { p1, p2, p3 } = await seedYearAnd3Periods();
    await uc.execute({ actor: admin, periodId: p1, isCurrent: true });
    await uc.execute({ actor: admin, periodId: p2, isCurrent: true });
    // p2 ahora es la actual (p1 fue desmarcada en el flip).
    const r = await uc.execute({ actor: admin, periodId: p2, isCurrent: false });
    expect(r.ok).toBe(true);
    expect((await periods.findById("i1", p1))?.isCurrent).toBe(false);
    expect((await periods.findById("i1", p2))?.isCurrent).toBe(false);
    expect((await periods.findById("i1", p3))?.isCurrent).toBe(false);
  });

  it("no-op si ya está en el estado deseado", async () => {
    const { p2 } = await seedYearAnd3Periods();
    await uc.execute({ actor: admin, periodId: p2, isCurrent: true });
    const r = await uc.execute({ actor: admin, periodId: p2, isCurrent: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.isCurrent).toBe(true);
  });

  it("rechaza si el periodo no existe", async () => {
    const r = await uc.execute({ actor: admin, periodId: "fantasma", isCurrent: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza a un no-ECU_MASTER", async () => {
    const { p2 } = await seedYearAnd3Periods();
    const r = await uc.execute({ actor: teacher, periodId: p2, isCurrent: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
