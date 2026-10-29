import { beforeEach, describe, expect, it } from "vitest";

import type { Course, Period, Subject } from "@/modules/academic/domain/types";
import {
  CreateEvaluationRule,
  DeleteEvaluationRule,
  FindRuleForEvaluation,
  ListEvaluationRulesByInstitution,
  ListEvaluationRulesByPeriod,
  UpdateEvaluationRule,
} from "@/modules/evaluation-rules/application/manage-evaluation-rules";
import type {
  BookletType,
  BookletTypeRepository,
} from "@/modules/booklet-types/domain/booklet-type";
import type {
  CreateEvaluationRuleData,
  EvaluationRule,
  EvaluationRuleRepository,
  UpdateEvaluationRuleData,
} from "@/modules/evaluation-rules/domain/evaluation-rule";
import type { Evaluation, EvaluationRepository } from "@/modules/evaluations/domain/evaluation";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { ConflictError, NotFoundError, ValidationError } from "@/shared/domain/result";

// ---------------------------------------------------------------------------
// Actores
// ---------------------------------------------------------------------------

const admin: AuthenticatedUser = {
  userId: "u1",
  institutionId: "inst1",
  roles: ["ECU_MASTER"],
};
const teacher: AuthenticatedUser = {
  userId: "t1",
  institutionId: "inst1",
  roles: ["TEACHER"],
};
const otherInstAdmin: AuthenticatedUser = {
  userId: "u2",
  institutionId: "inst2",
  roles: ["ECU_MASTER"],
};

// ---------------------------------------------------------------------------
// Fakes (in-memory) — minimalistas, solo lo que los use cases tocan.
// ---------------------------------------------------------------------------

class InMemoryRules implements EvaluationRuleRepository {
  /** idx únicos para createdAt estable. */
  private seq = 0;
  /** Map<id, rule> con institutionId para filtro. */
  private byId = new Map<string, EvaluationRule & { _seq: number }>();
  /** courseSubjectId → {courseId, subjectId} para findForEvaluation. */
  private courseSubjectMap = new Map<string, { courseId: string; subjectId: string }>();

  /** Toggle para tests específicos. */
  p2002OnCreate = false;

  setCourseSubject(id: string, courseId: string, subjectId: string) {
    this.courseSubjectMap.set(id, { courseId, subjectId });
  }

  async findById(institutionId: string, id: string) {
    const r = this.byId.get(id);
    if (!r || r.institutionId !== institutionId) return null;
    const { _seq: _s, ...rest } = r;
    return rest;
  }

  async listByPeriod(institutionId: string, periodId: string) {
    return Array.from(this.byId.values())
      .filter((r) => r.institutionId === institutionId && r.periodId === periodId)
      .sort(
        (a, b) => a.courseId.localeCompare(b.courseId) || a.subjectId.localeCompare(b.subjectId),
      )
      .map(({ _seq: _s, ...rest }) => rest);
  }

  async listByInstitution(institutionId: string) {
    return Array.from(this.byId.values())
      .filter((r) => r.institutionId === institutionId)
      .map(({ _seq: _s, ...rest }) => rest);
  }

  async create(institutionId: string, data: CreateEvaluationRuleData) {
    if (this.p2002OnCreate) {
      const err = new Error("Unique constraint") as Error & { code: string };
      err.code = "P2002";
      throw err;
    }
    this.seq += 1;
    const id = `r-${this.seq}`;
    const r: EvaluationRule & { _seq: number } = {
      id,
      institutionId,
      periodId: data.periodId,
      courseId: data.courseId,
      subjectId: data.subjectId,
      bookletTypeId: data.bookletTypeId,
      exactQuestions: data.exactQuestions,
      createdById: data.createdById,
      createdAt: new Date(this.seq * 1000),
      updatedAt: new Date(this.seq * 1000),
      _seq: this.seq,
    };
    this.byId.set(id, r);
    const { _seq: _s, ...rest } = r;
    return rest;
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateEvaluationRuleData,
  ): Promise<EvaluationRule | null> {
    const current = this.byId.get(id);
    if (!current || current.institutionId !== institutionId) return null;
    const next: EvaluationRule & { _seq: number } = {
      ...current,
      ...(data.exactQuestions !== undefined ? { exactQuestions: data.exactQuestions } : {}),
      updatedAt: new Date(),
    };
    this.byId.set(id, next);
    const { _seq: _s, ...rest } = next;
    return rest;
  }

  async delete(institutionId: string, id: string) {
    const current = this.byId.get(id);
    if (!current || current.institutionId !== institutionId) return;
    this.byId.delete(id);
  }

  async findForEvaluation(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
    bookletTypeId: string | null,
  ) {
    if (periodId === null) return null;
    const cs = this.courseSubjectMap.get(courseSubjectId);
    if (!cs) return null;
    const r = Array.from(this.byId.values()).find(
      (r) =>
        r.institutionId === institutionId &&
        r.periodId === periodId &&
        r.courseId === cs.courseId &&
        r.subjectId === cs.subjectId &&
        r.bookletTypeId === bookletTypeId,
    );
    if (!r) return null;
    const { _seq: _s, ...rest } = r;
    return rest;
  }
}

class InMemoryPeriods {
  items: Period[] = [];
  async findById(institutionId: string, id: string) {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  async findByName(institutionId: string, name: string) {
    const trimmed = name.trim().toLowerCase();
    const matches = this.items.filter(
      (p) => p.institutionId === institutionId && p.name.trim().toLowerCase() === trimmed,
    );
    matches.sort((a, b) => a.order - b.order);
    return matches[0] ?? null;
  }
  // Stubs para satisfacer la interfaz completa de PeriodRepository.
  async findAll(): Promise<Period[]> {
    return [];
  }
  async create(): Promise<Period> {
    throw new Error("noop");
  }
  async update(): Promise<Period | null> {
    return null;
  }
  async delete(): Promise<void> {
    /* noop */
  }
  async setCurrent(): Promise<void> {
    /* noop */
  }
  async findCurrent(): Promise<Period | null> {
    return null;
  }
}

class InMemoryCourses {
  items: Course[] = [];
  async findById(institutionId: string, id: string) {
    return this.items.find((c) => c.institutionId === institutionId && c.id === id) ?? null;
  }
  async findAll(): Promise<Course[]> {
    return [];
  }
  async create(): Promise<Course> {
    throw new Error("noop");
  }
}

class InMemorySubjects {
  items: Subject[] = [];
  async findById(id: string) {
    return this.items.find((s) => s.id === id) ?? null;
  }
  async findAllForInstitution(): Promise<Subject[]> {
    return [];
  }
  async create(): Promise<Subject> {
    throw new Error("noop");
  }
  async updateShortName(): Promise<Subject> {
    throw new Error("noop");
  }
}

class InMemoryBookletTypes implements BookletTypeRepository {
  items: BookletType[] = [];
  async findById(institutionId: string, id: string) {
    return this.items.find((b) => b.institutionId === institutionId && b.id === id) ?? null;
  }
  // Métodos no usados por los use cases bajo test — stubs vacíos.
  async listByPeriod() {
    return [];
  }
  async listByInstitution() {
    return [];
  }
  async findByName() {
    return [];
  }
  async findByNameAndPeriod() {
    return [];
  }
  async create(): Promise<BookletType> {
    throw new Error("noop");
  }
  async update(): Promise<BookletType | null> {
    return null;
  }
  async delete() {
    /* noop */
  }
}

class InMemoryEvaluations implements EvaluationRepository {
  items: Evaluation[] = [];
  async findById(institutionId: string, id: string) {
    return this.items.find((e) => e.institutionId === institutionId && e.id === id) ?? null;
  }
  // Métodos no usados por FindRuleForEvaluation — stubs para satisfacer
  // la interfaz completa de EvaluationRepository (typecheck estricto).
  async getDetail() {
    return null;
  }
  async findByTeacher() {
    return [];
  }
  async findByInstitution() {
    return [];
  }
  async findByCourseIds() {
    return [];
  }
  async findOwnedDraft() {
    return null;
  }
  async listOwnedDrafts() {
    return [];
  }
  async listAll() {
    return [];
  }
  async create(): Promise<Evaluation> {
    throw new Error("noop");
  }
  async updateStatus(): Promise<void> {
    throw new Error("noop");
  }
  async updateSettings(): Promise<Evaluation> {
    throw new Error("noop");
  }
  async addSection(): Promise<never> {
    throw new Error("noop");
  }
  async updateSection(): Promise<never> {
    throw new Error("noop");
  }
  async deleteSection(): Promise<void> {
    /* noop */
  }
  async countSections(): Promise<number> {
    return 0;
  }
  async addQuestion(): Promise<never> {
    throw new Error("noop");
  }
  async updateQuestion(): Promise<never> {
    throw new Error("noop");
  }
  async deleteQuestion(): Promise<void> {
    /* noop */
  }
  async duplicateQuestion(): Promise<void> {
    /* noop */
  }
  async findQuestionSectionId(): Promise<string | null> {
    return null;
  }
  async countQuestionsInSection(): Promise<number> {
    return 0;
  }
  async reorderQuestions(): Promise<void> {
    /* noop */
  }
  async createNewVersion(): Promise<Evaluation> {
    throw new Error("noop");
  }
  async existsByCourseSubjectPeriodBookletTypeYear(): Promise<boolean> {
    return false;
  }
  /** Stub: la evaluación no tiene courseId resuelto en este fake (la única
   *  ruta que la usa es `FindRuleForEvaluation`, que no toca scope). */
  async findCourseIdByEvaluation(): Promise<string | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let rules: InMemoryRules;
let periods: InMemoryPeriods;
let courses: InMemoryCourses;
let subjects: InMemorySubjects;
let bookletTypes: InMemoryBookletTypes;
let evaluations: InMemoryEvaluations;

beforeEach(() => {
  rules = new InMemoryRules();
  periods = new InMemoryPeriods();
  courses = new InMemoryCourses();
  subjects = new InMemorySubjects();
  bookletTypes = new InMemoryBookletTypes();
  evaluations = new InMemoryEvaluations();

  // Catálogos base
  periods.items.push({
    id: "p1",
    institutionId: "inst1",
    academicYearId: "ay1",
    name: "I Periodo",
    order: 1,
    startDate: new Date("2026-02-01"),
    endDate: new Date("2026-05-01"),
    isCurrent: true,
  });
  courses.items.push({
    id: "c1",
    institutionId: "inst1",
    academicYearId: "ay1",
    name: "11°",
    code: "11",
  });
  subjects.items.push({
    id: "s1",
    institutionId: "inst1",
    name: "Matemáticas",
    code: "MAT",
    shortName: null,
  });
  bookletTypes.items.push({
    id: "bt1",
    institutionId: "inst1",
    periodId: "p1",
    name: "Estándar",
    description: null,
    order: 0,
  });
  bookletTypes.items.push({
    id: "bt2",
    institutionId: "inst1",
    periodId: "p1",
    name: "Especial",
    description: null,
    order: 1,
  });
});

// ===========================================================================
// CreateEvaluationRule
// ===========================================================================

describe("CreateEvaluationRule", () => {
  const useCase = () => new CreateEvaluationRule(rules, periods, courses, subjects, bookletTypes);

  const validInput = {
    actor: admin,
    data: {
      periodId: "p1",
      courseId: "c1",
      subjectId: "s1",
      bookletTypeId: "bt1",
      exactQuestions: 50,
    },
  };

  it("crea una regla válida", async () => {
    const res = await useCase().execute(validInput);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.institutionId).toBe("inst1");
    expect(res.value.exactQuestions).toBe(50);
    expect(res.value.bookletTypeId).toBe("bt1");
    expect(res.value.createdById).toBe("u1");
  });

  it("rechaza exactQuestions fuera de [1,500] con VALIDATION", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, exactQuestions: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("rechaza exactQuestions > 500 con VALIDATION", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, exactQuestions: 501 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("rechaza exactQuestions no entero con VALIDATION", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, exactQuestions: 50.5 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("rechaza Prueba inexistente con NOT_FOUND", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, periodId: "no-existe" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("rechaza Grado inexistente con NOT_FOUND", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, courseId: "no-existe" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("rechaza Asignatura inexistente con NOT_FOUND", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, subjectId: "no-existe" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("rechaza tipo de cuadernillo de otra Prueba con VALIDATION", async () => {
    // bt1 pertenece a p1; simulamos que se pide con un periodId distinto
    periods.items.push({
      id: "p2",
      institutionId: "inst1",
      academicYearId: "ay1",
      name: "II Periodo",
      order: 2,
      startDate: new Date(),
      endDate: new Date(),
      isCurrent: false,
    });
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, periodId: "p2" }, // bt1 sigue apuntando a p1
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("rechaza tupla duplicada con CONFLICT (pre-check)", async () => {
    await useCase().execute(validInput);
    const res = await useCase().execute(validInput);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ConflictError);
  });

  it("atrapa P2002 desde el repo y lo convierte a CONFLICT", async () => {
    // Si el pre-check pasó (ej. carrera concurrente) y Postgres lanza P2002,
    // el use case debe traducirlo a ConflictError legible.
    rules.p2002OnCreate = true;
    const res = await useCase().execute(validInput);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ConflictError);
  });

  it("rechaza bookletTypeId vacío", async () => {
    const res = await useCase().execute({
      ...validInput,
      data: { ...validInput.data, bookletTypeId: "" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("solo ECU_MASTER puede crear (TEACHER → FORBIDDEN)", async () => {
    const res = await useCase().execute({ ...validInput, actor: teacher });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.name).toBe("ForbiddenError");
  });
});

// ===========================================================================
// ListEvaluationRulesByPeriod
// ===========================================================================

describe("ListEvaluationRulesByPeriod", () => {
  const seed = async () => {
    await new CreateEvaluationRule(rules, periods, courses, subjects, bookletTypes).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt1",
        exactQuestions: 50,
      },
    });
  };

  it("filtra por Prueba y trae solo las de la institución del actor", async () => {
    await seed();
    const res = await new ListEvaluationRulesByPeriod(rules).execute({
      actor: admin,
      periodId: "p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.length).toBe(1);
    expect(res.value[0]?.institutionId).toBe("inst1");
  });

  it("devuelve [] cuando no hay reglas en la Prueba", async () => {
    const res = await new ListEvaluationRulesByPeriod(rules).execute({
      actor: admin,
      periodId: "p1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it("cualquier rol con sesión puede listar", async () => {
    const res = await new ListEvaluationRulesByPeriod(rules).execute({
      actor: teacher,
      periodId: "p1",
    });
    expect(res.ok).toBe(true);
  });
});

// ===========================================================================
// ListEvaluationRulesByInstitution
// ===========================================================================

describe("ListEvaluationRulesByInstitution", () => {
  it("trae todas las reglas de la institución del actor", async () => {
    await new CreateEvaluationRule(rules, periods, courses, subjects, bookletTypes).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt1",
        exactQuestions: 50,
      },
    });
    const res = await new ListEvaluationRulesByInstitution(rules).execute({ actor: admin });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.length).toBe(1);
  });
});

// ===========================================================================
// UpdateEvaluationRule
// ===========================================================================

describe("UpdateEvaluationRule", () => {
  const seed = async () => {
    const created = await new CreateEvaluationRule(
      rules,
      periods,
      courses,
      subjects,
      bookletTypes,
    ).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt1",
        exactQuestions: 50,
      },
    });
    if (!created.ok) throw new Error("seed failed");
    return created.value;
  };

  it("actualiza exactQuestions", async () => {
    const rule = await seed();
    const res = await new UpdateEvaluationRule(rules).execute({
      actor: admin,
      id: rule.id,
      data: { exactQuestions: 75 },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.exactQuestions).toBe(75);
  });

  it("rechaza exactQuestions inválido con VALIDATION", async () => {
    const rule = await seed();
    const res = await new UpdateEvaluationRule(rules).execute({
      actor: admin,
      id: rule.id,
      data: { exactQuestions: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("rechaza si la regla no existe con NOT_FOUND", async () => {
    const res = await new UpdateEvaluationRule(rules).execute({
      actor: admin,
      id: "no-existe",
      data: { exactQuestions: 50 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("bloquea acceso cross-tenant", async () => {
    const rule = await seed();
    const res = await new UpdateEvaluationRule(rules).execute({
      actor: otherInstAdmin, // inst2
      id: rule.id,
      data: { exactQuestions: 75 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("solo ECU_MASTER puede editar", async () => {
    const rule = await seed();
    const res = await new UpdateEvaluationRule(rules).execute({
      actor: teacher,
      id: rule.id,
      data: { exactQuestions: 75 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.name).toBe("ForbiddenError");
  });
});

// ===========================================================================
// DeleteEvaluationRule
// ===========================================================================

describe("DeleteEvaluationRule", () => {
  const seed = async () => {
    const created = await new CreateEvaluationRule(
      rules,
      periods,
      courses,
      subjects,
      bookletTypes,
    ).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt1",
        exactQuestions: 50,
      },
    });
    if (!created.ok) throw new Error("seed failed");
    return created.value;
  };

  it("elimina una regla existente", async () => {
    const rule = await seed();
    const res = await new DeleteEvaluationRule(rules).execute({
      actor: admin,
      id: rule.id,
    });
    expect(res.ok).toBe(true);
    const remaining = await rules.listByInstitution("inst1");
    expect(remaining).toHaveLength(0);
  });

  it("rechaza si la regla no existe con NOT_FOUND", async () => {
    const res = await new DeleteEvaluationRule(rules).execute({
      actor: admin,
      id: "no-existe",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("bloquea acceso cross-tenant", async () => {
    const rule = await seed();
    const res = await new DeleteEvaluationRule(rules).execute({
      actor: otherInstAdmin,
      id: rule.id,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("solo ECU_MASTER puede eliminar", async () => {
    const rule = await seed();
    const res = await new DeleteEvaluationRule(rules).execute({
      actor: teacher,
      id: rule.id,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.name).toBe("ForbiddenError");
  });
});

// ===========================================================================
// FindRuleForEvaluation
// ===========================================================================

describe("FindRuleForEvaluation", () => {
  const seedRule = async () => {
    const created = await new CreateEvaluationRule(
      rules,
      periods,
      courses,
      subjects,
      bookletTypes,
    ).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt1",
        exactQuestions: 50,
      },
    });
    if (!created.ok) throw new Error("seed failed");
    return created.value;
  };

  const seedEvaluation = (overrides: Partial<Evaluation> = {}) => {
    evaluations.items.push({
      id: "e1",
      institutionId: "inst1",
      title: "Mat 11 - I Periodo",
      description: null,
      version: 1,
      status: "DRAFT",
      courseSubjectId: "cs1",
      academicYearId: "ay1",
      periodId: "p1",
      teacherId: "t1",
      bookletNumber: null,
      bookletTypeId: "bt1",
      totalQuestions: 49,
      durationMinutes: null,
      theme: null,
      ...overrides,
    });
  };

  it("devuelve la regla cuando la tupla coincide", async () => {
    const rule = await seedRule();
    rules.setCourseSubject("cs1", "c1", "s1");
    seedEvaluation();

    const res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.id).toBe(rule.id);
  });

  it("devuelve null cuando no hay regla (modo libre)", async () => {
    rules.setCourseSubject("cs1", "c1", "s1");
    seedEvaluation();

    const res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeNull();
  });

  it("devuelve null cuando la evaluation no tiene periodId", async () => {
    await seedRule();
    rules.setCourseSubject("cs1", "c1", "s1");
    seedEvaluation({ periodId: null });

    const res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeNull();
  });

  it("distingue bookletTypeId específico (cada tipo exige su propia regla)", async () => {
    // Regla para bt1 (Estándar) con 30 ítems
    const c1 = await new CreateEvaluationRule(
      rules,
      periods,
      courses,
      subjects,
      bookletTypes,
    ).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt1",
        exactQuestions: 30,
      },
    });
    expect(c1.ok).toBe(true);

    // Regla para bt2 (Especial) con 40 ítems (misma tupla cambia solo
    // bookletTypeId — el unique constraint lo permite).
    const c2 = await new CreateEvaluationRule(
      rules,
      periods,
      courses,
      subjects,
      bookletTypes,
    ).execute({
      actor: admin,
      data: {
        periodId: "p1",
        courseId: "c1",
        subjectId: "s1",
        bookletTypeId: "bt2",
        exactQuestions: 40,
      },
    });
    expect(c2.ok).toBe(true);

    rules.setCourseSubject("cs1", "c1", "s1");

    // Evaluación con bt1 → matchea la regla de 30
    seedEvaluation({ bookletTypeId: "bt1" });
    let res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.exactQuestions).toBe(30);

    // Evaluación con bt2 → matchea la regla de 40 (no la de 30)
    evaluations.items[0]!.bookletTypeId = "bt2";
    res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.exactQuestions).toBe(40);

    // Evaluación con bookletTypeId no presente en ninguna regla → no matchea.
    evaluations.items[0]!.bookletTypeId = "bt-inexistente";
    res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeNull();
  });

  it("rechaza con NOT_FOUND si la evaluation no existe", async () => {
    const res = await new FindRuleForEvaluation(evaluations, rules).execute({
      actor: teacher,
      evaluationId: "no-existe",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });
});
