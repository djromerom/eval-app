import { beforeEach, describe, expect, it } from "vitest";

import type { Course, Period, Subject } from "@/modules/academic/domain/types";
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
import { CloneEvaluationRules } from "@/modules/evaluation-rules/application/clone-evaluation-rules";
import { CreateEvaluationRule } from "@/modules/evaluation-rules/application/manage-evaluation-rules";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { NotFoundError, ValidationError } from "@/shared/domain/result";

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
// Fakes (in-memory)
// ---------------------------------------------------------------------------

class InMemoryRules implements EvaluationRuleRepository {
  private seq = 0;
  private byId = new Map<string, EvaluationRule>();

  async findById(institutionId: string, id: string) {
    const r = this.byId.get(id);
    if (!r || r.institutionId !== institutionId) return null;
    return r;
  }

  async listByPeriod(institutionId: string, periodId: string) {
    return Array.from(this.byId.values()).filter(
      (r) => r.institutionId === institutionId && r.periodId === periodId,
    );
  }

  async listByInstitution(institutionId: string) {
    return Array.from(this.byId.values()).filter((r) => r.institutionId === institutionId);
  }

  async create(institutionId: string, data: CreateEvaluationRuleData) {
    // Reproducimos el índice unique de Postgres: la tupla
    // (periodId, courseId, subjectId, bookletTypeId) no puede repetirse.
    const duplicate = Array.from(this.byId.values()).some(
      (r) =>
        r.institutionId === institutionId &&
        r.periodId === data.periodId &&
        r.courseId === data.courseId &&
        r.subjectId === data.subjectId &&
        r.bookletTypeId === data.bookletTypeId,
    );
    if (duplicate) {
      const err = new Error("Unique constraint") as Error & { code: string };
      err.code = "P2002";
      throw err;
    }
    this.seq += 1;
    const id = `r-${this.seq}`;
    const rule: EvaluationRule = {
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
    };
    this.byId.set(id, rule);
    return rule;
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateEvaluationRuleData,
  ): Promise<EvaluationRule | null> {
    const current = this.byId.get(id);
    if (!current || current.institutionId !== institutionId) return null;
    const next = { ...current, ...data, updatedAt: new Date() };
    this.byId.set(id, next);
    return next;
  }

  async delete(institutionId: string, id: string) {
    const current = this.byId.get(id);
    if (!current || current.institutionId !== institutionId) return;
    this.byId.delete(id);
  }

  async findForEvaluation(): Promise<EvaluationRule | null> {
    return null;
  }
}

class InMemoryPeriods {
  items: Period[] = [];
  async findById(institutionId: string, id: string) {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  async findAll(): Promise<Period[]> {
    return [];
  }
  async findByName(): Promise<Period | null> {
    return null;
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
  async findAll(institutionId: string, academicYearId?: string) {
    return this.items.filter(
      (c) =>
        c.institutionId === institutionId &&
        (academicYearId === undefined || c.academicYearId === academicYearId),
    );
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
  async listByPeriod(institutionId: string, periodId: string) {
    return this.items.filter((b) => b.institutionId === institutionId && b.periodId === periodId);
  }
  async listByInstitution(institutionId: string) {
    return this.items.filter((b) => b.institutionId === institutionId);
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
  async delete(): Promise<void> {
    /* noop */
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

const useCase = () =>
  new CloneEvaluationRules(
    rules,
    periods,
    courses,
    subjects,
    bookletTypes,
    new CreateEvaluationRule(rules, periods, courses, subjects, bookletTypes),
  );

/** Crea una regla directamente en el repo (sin pasar por el use case). */
async function seedRule(
  periodId: string,
  courseId: string,
  subjectId: string,
  bookletTypeId: string,
  exactQuestions: number,
) {
  return rules.create("inst1", {
    periodId,
    courseId,
    subjectId,
    bookletTypeId,
    exactQuestions,
    createdById: "u1",
  });
}

beforeEach(() => {
  rules = new InMemoryRules();
  periods = new InMemoryPeriods();
  courses = new InMemoryCourses();
  subjects = new InMemorySubjects();
  bookletTypes = new InMemoryBookletTypes();

  // Pruebas: p1 (origen, 2026) y p2 (destino, 2026, mismo año).
  periods.items.push(
    {
      id: "p1",
      institutionId: "inst1",
      academicYearId: "ay2026",
      name: "2026-2",
      order: 1,
      startDate: new Date("2026-02-01"),
      endDate: new Date("2026-06-01"),
      isCurrent: true,
    },
    {
      id: "p2",
      institutionId: "inst1",
      academicYearId: "ay2026",
      name: "2026-3",
      order: 2,
      startDate: new Date("2026-07-01"),
      endDate: new Date("2026-11-01"),
      isCurrent: false,
    },
    {
      id: "p3",
      institutionId: "inst1",
      academicYearId: "ay2027",
      name: "1",
      order: 1,
      startDate: new Date("2027-02-01"),
      endDate: new Date("2027-06-01"),
      isCurrent: false,
    },
  );

  courses.items.push(
    {
      id: "c6",
      institutionId: "inst1",
      academicYearId: "ay2026",
      name: "6°",
      code: "6",
    },
    {
      id: "c11",
      institutionId: "inst1",
      academicYearId: "ay2026",
      name: "11°",
      code: "11",
    },
    {
      id: "c6-2027",
      institutionId: "inst1",
      academicYearId: "ay2027",
      name: "6°",
      code: "6",
    },
  );

  subjects.items.push(
    {
      id: "s-mat",
      institutionId: "inst1",
      name: "Matemáticas",
      code: "MAT",
      shortName: null,
    },
    {
      id: "s-leng",
      institutionId: "inst1",
      name: "Lenguaje",
      code: "LEN",
      shortName: null,
    },
  );

  // Tipos de cuadernillo: en el origen con la grafía SIN tilde ("Estandar")
  // y en el destino con la grafía CORRECTA ("Estándar") — a propósito, para
  // probar que el mapeo es por nombre normalizado.
  bookletTypes.items.push(
    {
      id: "bt-src-estandar",
      institutionId: "inst1",
      periodId: "p1",
      name: "Estandar",
      description: null,
      order: 0,
    },
    {
      id: "bt-src-especial",
      institutionId: "inst1",
      periodId: "p1",
      name: "Especial",
      description: null,
      order: 1,
    },
    {
      id: "bt-dst-estandar",
      institutionId: "inst1",
      periodId: "p2",
      name: "Estándar",
      description: null,
      order: 0,
    },
    {
      id: "bt-2027-estandar",
      institutionId: "inst1",
      periodId: "p3",
      name: "Estándar",
      description: null,
      order: 0,
    },
  );
});

// ===========================================================================
// CloneEvaluationRules
// ===========================================================================

describe("CloneEvaluationRules", () => {
  it("clona todas las reglas cuando el destino está vacío", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-estandar", 25);
    await seedRule("p1", "c11", "s-leng", "bt-src-estandar", 40);

    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(2);
    expect(res.value.kept).toBe(0);
    expect(res.value.skipped).toBe(0);

    const target = await rules.listByPeriod("inst1", "p2");
    expect(target).toHaveLength(2);
    expect(target.map((r) => r.exactQuestions).sort()).toEqual([25, 40]);
    // El tipo de cuadernillo del destino es el equivalente por nombre.
    expect(target.every((r) => r.bookletTypeId === "bt-dst-estandar")).toBe(true);
  });

  it("NO duplica ni reescribe una regla que ya existe en el destino", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-estandar", 25);
    // En el destino YA hay una regla para la misma tupla, con OTRO conteo.
    await seedRule("p2", "c6", "s-mat", "bt-dst-estandar", 99);

    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(0);
    expect(res.value.kept).toBe(1);
    expect(res.value.skipped).toBe(0);
    expect(res.value.outcomes[0]?.status).toBe("conservada");

    // La regla preexistente conserva su conteo original (99, no 25) y no
    // hay duplicados.
    const target = await rules.listByPeriod("inst1", "p2");
    expect(target).toHaveLength(1);
    expect(target[0]?.exactQuestions).toBe(99);
  });

  it("es idempotente: el segundo clon no crea nada nuevo", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-estandar", 25);

    const first = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.cloned).toBe(1);

    const second = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.cloned).toBe(0);
    expect(second.value.kept).toBe(1);

    const target = await rules.listByPeriod("inst1", "p2");
    expect(target).toHaveLength(1);
    expect(target[0]?.exactQuestions).toBe(25);
  });

  it("empareja el tipo de cuadernillo por nombre normalizado (Estandar ≈ Estándar)", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-estandar", 25);

    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(1);
    expect(res.value.skipped).toBe(0);

    const target = await rules.listByPeriod("inst1", "p2");
    expect(target[0]?.bookletTypeId).toBe("bt-dst-estandar");
  });

  it("omite la regla si el destino no tiene un tipo de cuadernillo equivalente", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-especial", 25);

    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(0);
    expect(res.value.skipped).toBe(1);
    expect(res.value.outcomes[0]?.status).toBe("omitida");
    expect(res.value.outcomes[0]?.motivo).toContain("tipo de cuadernillo");

    const target = await rules.listByPeriod("inst1", "p2");
    expect(target).toHaveLength(0);
  });

  it("mapea el grado por `code` cuando el destino es de otro año académico", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-estandar", 25);

    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p3",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(1);
    expect(res.value.skipped).toBe(0);

    const target = await rules.listByPeriod("inst1", "p3");
    // El grado 6° del 2027 (mismo `code` "6"), no el del 2026.
    expect(target[0]?.courseId).toBe("c6-2027");
    expect(target[0]?.bookletTypeId).toBe("bt-2027-estandar");
  });

  it("omite la regla si el destino no tiene un grado equivalente", async () => {
    // 11° solo existe en el año 2026; el destino es 2027.
    await seedRule("p1", "c11", "s-leng", "bt-src-estandar", 40);

    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p3",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(0);
    expect(res.value.skipped).toBe(1);
    expect(res.value.outcomes[0]?.motivo).toContain("grado equivalente");
  });

  it("rechaza clonar una prueba sobre sí misma con VALIDATION", async () => {
    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p1",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(ValidationError);
  });

  it("rechaza una Prueba de origen inexistente con NOT_FOUND", async () => {
    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "no-existe",
      targetPeriodId: "p2",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("bloquea acceso cross-tenant (otra institución)", async () => {
    await seedRule("p1", "c6", "s-mat", "bt-src-estandar", 25);

    const res = await useCase().execute({
      actor: otherInstAdmin, // inst2
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(NotFoundError);
  });

  it("solo ECU_MASTER puede clonar (TEACHER → FORBIDDEN)", async () => {
    const res = await useCase().execute({
      actor: teacher,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.name).toBe("ForbiddenError");
  });

  it("no clona nada cuando la Prueba de origen no tiene reglas", async () => {
    const res = await useCase().execute({
      actor: admin,
      sourcePeriodId: "p1",
      targetPeriodId: "p2",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cloned).toBe(0);
    expect(res.value.kept).toBe(0);
    expect(res.value.skipped).toBe(0);
    expect(res.value.outcomes).toEqual([]);
  });
});
