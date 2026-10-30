/**
 * Sprint oct 2026 — Reglas de OPCIONES DE RESPUESTA por (Prueba × Asignatura).
 *
 * Tres capas:
 *  1. Dominio puro: qué es un rango válido y cómo se describe.
 *  2. Casos de uso de la regla (CRUD del panel de la Prueba).
 *  3. ENFORCEMENT: el bloqueo duro al guardar (evaluaciones, banco, importación).
 */

import { describe, expect, it } from "vitest";

import type {
  Evaluation,
  EvaluationDetail,
  EvaluationSection,
  Question,
} from "@/modules/evaluations/domain/evaluation";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import { AddQuestion, UpdateQuestion } from "@/modules/evaluations/application/manage-evaluations";
import type { EvaluationRuleRepository } from "@/modules/evaluation-rules/domain/evaluation-rule";
import type {
  BankQuestion,
  BankQuestionFilters,
  BankQuestionRepository,
  CreateBankQuestionData,
} from "@/modules/question-bank/domain/bank-question";
import {
  CreateBankQuestion,
  ExportQuestionToBank,
  ImportBankQuestion,
} from "@/modules/question-bank/application/manage-bank";
import type { ParsedQuestion } from "@/modules/question-import/domain/parsed-question";
import { ImportQuestions } from "@/modules/question-import/application/import-questions";
import type {
  CreateOptionRuleData,
  OptionRule,
  OptionRuleRepository,
  OptionRuleResolver,
  OptionsRange,
  UpdateOptionRuleData,
} from "@/modules/option-rules/domain/option-rule";
import {
  DEFAULT_OPTIONS_RANGE,
  describeOptionsRange,
  initialOptionsCount,
  isOptionsCountAllowed,
  isValidOptionsRange,
  optionsCountErrorMessage,
  resolveOptionsRange,
} from "@/modules/option-rules/domain/option-rule";
import {
  CreateOptionRule,
  DeleteOptionRule,
  ListOptionRulesByPeriod,
  UpdateOptionRule,
} from "@/modules/option-rules/application/manage-option-rules";
import type {
  CreatePeriodData,
  CreateSubjectData,
  Period,
  PeriodRepository,
  Subject,
  SubjectRepository,
  UpdatePeriodData,
} from "@/modules/academic/domain/types";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { FakeEvaluations } from "./fakes/evaluations";

// ---------------------------------------------------------------------------
// Actores
// ---------------------------------------------------------------------------

const teacher: AuthenticatedUser = { userId: "t1", institutionId: "i1", roles: ["TEACHER"] };
const master: AuthenticatedUser = { userId: "m1", institutionId: "i1", roles: ["ECU_MASTER"] };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Repo de reglas en memoria. `createError` simula el P2002 de Postgres. */
class FakeOptionRules implements OptionRuleRepository {
  items: OptionRule[] = [];
  nextId = 1;
  createError: unknown = null;
  /** Mapa courseSubjectId → subjectId, para `findForCourseSubject`. */
  courseSubjectSubject: Record<string, string> = {};

  async findById(institutionId: string, id: string) {
    return this.items.find((r) => r.institutionId === institutionId && r.id === id) ?? null;
  }
  async listByPeriod(institutionId: string, periodId: string) {
    return this.items.filter((r) => r.institutionId === institutionId && r.periodId === periodId);
  }
  async listByInstitution(institutionId: string) {
    return this.items.filter((r) => r.institutionId === institutionId);
  }
  async listBySubject(institutionId: string, subjectId: string) {
    return this.items.filter((r) => r.institutionId === institutionId && r.subjectId === subjectId);
  }
  async create(institutionId: string, data: CreateOptionRuleData) {
    if (this.createError) throw this.createError;
    const rule: OptionRule = {
      id: `r${this.nextId++}`,
      institutionId,
      periodId: data.periodId,
      subjectId: data.subjectId,
      minOptions: data.minOptions,
      maxOptions: data.maxOptions,
      createdById: data.createdById,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.items.push(rule);
    return rule;
  }
  async update(institutionId: string, id: string, data: UpdateOptionRuleData) {
    const rule = this.items.find((r) => r.institutionId === institutionId && r.id === id);
    if (!rule) return null;
    if (data.minOptions !== undefined) rule.minOptions = data.minOptions;
    if (data.maxOptions !== undefined) rule.maxOptions = data.maxOptions;
    rule.updatedAt = new Date();
    return rule;
  }
  async delete(institutionId: string, id: string) {
    this.items = this.items.filter((r) => !(r.institutionId === institutionId && r.id === id));
  }
  async findForCourseSubject(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
  ) {
    const subjectId = this.courseSubjectSubject[courseSubjectId];
    if (!subjectId || !periodId) return null;
    return (
      this.items.find(
        (r) =>
          r.institutionId === institutionId && r.periodId === periodId && r.subjectId === subjectId,
      ) ?? null
    );
  }
}

/** Resolver con rangos configurables por test. */
class FakeResolver implements OptionRuleResolver {
  evaluationRange: OptionsRange = { min: 4, max: 4 };
  subjectRanges: Record<string, OptionsRange> = {};
  /** Rangos devueltos por `forEvaluation`, por courseSubjectId. */
  evaluationRanges: Record<string, OptionsRange> = {};

  async forEvaluation(
    _institutionId: string,
    courseSubjectId: string,
    _periodId: string | null,
  ): Promise<OptionsRange> {
    return this.evaluationRanges[courseSubjectId] ?? this.evaluationRange;
  }
  async forSubject(_institutionId: string, subjectId: string): Promise<OptionsRange> {
    return this.subjectRanges[subjectId] ?? { min: 4, max: 4 };
  }
  async forSubjects(
    _institutionId: string,
    subjectIds: string[],
  ): Promise<Record<string, OptionsRange>> {
    const out: Record<string, OptionsRange> = {};
    for (const id of subjectIds) out[id] = this.subjectRanges[id] ?? { min: 4, max: 4 };
    return out;
  }
}

class FakePeriods implements PeriodRepository {
  items: Period[] = [];
  async findAll() {
    return this.items;
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  async findByName() {
    return null;
  }
  async create(_i: string, _d: CreatePeriodData): Promise<Period> {
    throw new Error("noop");
  }
  async update(_i: string, _id: string, _d: UpdatePeriodData): Promise<Period | null> {
    return null;
  }
  async delete() {
    /* noop */
  }
  async setCurrent() {
    /* noop */
  }
  async findCurrent() {
    return null;
  }
}

class FakeSubjects implements SubjectRepository {
  items: Subject[] = [];
  async findAllForInstitution() {
    return this.items;
  }
  async findById(id: string) {
    return this.items.find((s) => s.id === id) ?? null;
  }
  async create(_i: string | null, _d: CreateSubjectData): Promise<Subject> {
    throw new Error("noop");
  }
  async updateShortName(id: string, shortName: string | null): Promise<Subject> {
    const s = this.items.find((x) => x.id === id);
    if (!s) throw new Error("noop");
    s.shortName = shortName;
    return s;
  }
}

/** Repo de reglas de conteo: sin regla → no hay enforcement de conteo. */
class FakeEvaluationRules implements EvaluationRuleRepository {
  async findForEvaluation() {
    return null;
  }
  async findById() {
    return null;
  }
  async listByPeriod() {
    return [];
  }
  async listByInstitution() {
    return [];
  }
  async create(): Promise<never> {
    return {} as never;
  }
  async update(): Promise<never> {
    return {} as never;
  }
  async delete() {
    /* noop */
  }
}

class FakeBank implements BankQuestionRepository {
  items: BankQuestion[] = [];
  created: CreateBankQuestionData[] = [];

  async create(
    institutionId: string,
    createdBy: string,
    data: CreateBankQuestionData,
  ): Promise<BankQuestion> {
    this.created.push(data);
    const bank: BankQuestion = {
      id: `bq${this.items.length + 1}`,
      institutionId,
      subjectId: data.subjectId,
      subjectName: "Matemáticas",
      text: data.text,
      options: data.options,
      correctAnswer: data.correctAnswer,
      justification: data.justification ?? null,
      soloLevel: data.soloLevel ?? null,
      menComponent: data.menComponent ?? null,
      competency: data.competency ?? null,
      evidence: data.evidence ?? null,
      difficulty: data.difficulty ?? "MEDIUM",
      tags: data.tags ?? [],
      isPersonal: data.isPersonal ?? false,
      createdBy,
    };
    this.items.push(bank);
    return bank;
  }
  async createMany(_institutionId: string, _createdBy: string, data: CreateBankQuestionData[]) {
    this.created.push(...data);
    return data.length;
  }
  async findVisible(institutionId: string, _userId: string, id: string) {
    return this.items.find((b) => b.institutionId === institutionId && b.id === id) ?? null;
  }
  async search(_institutionId: string, _userId: string, _f: BankQuestionFilters) {
    return this.items;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvaluation(overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: "e1",
    institutionId: "i1",
    title: "Formulación de prueba",
    description: null,
    version: 1,
    status: "DRAFT",
    courseSubjectId: "cs1",
    academicYearId: "ay1",
    periodId: "p1",
    teacherId: "t1",
    bookletNumber: 1,
    bookletTypeId: "bt1",
    totalQuestions: 0,
    durationMinutes: null,
    theme: null,
    ...overrides,
  };
}

function makeDetail(evaluation: Evaluation, sections: EvaluationSection[] = []): EvaluationDetail {
  return { ...evaluation, sections };
}

function makeSection(questions: Question[] = []): EvaluationSection {
  return {
    id: "sec1",
    title: null,
    content: null,
    order: 1,
    questions,
    columnLayoutOverride: null,
  };
}

function makeQuestion(count: number, id = "q1"): Question {
  return {
    id,
    number: 1,
    text: "Enunciado de la pregunta",
    image: null,
    sectionId: "sec1",
    options: ANSWER_KEYS_ORDER.slice(0, count).map((key) => ({ key, text: `Opción ${key}` })),
    correctAnswer: "A",
    justification: null,
    weight: 1,
    soloLevel: null,
    menComponent: null,
    competency: null,
  };
}

function makeQuestionData(count: number) {
  return {
    text: "Enunciado de la pregunta",
    options: ANSWER_KEYS_ORDER.slice(0, count).map((key) => ({ key, text: `Opción ${key}` })),
    correctAnswer: "A" as const,
  };
}

function makeParsedQuestion(count: number, text: string): ParsedQuestion {
  return {
    sourceNumber: null,
    text,
    options: ANSWER_KEYS_ORDER.slice(0, count).map((key) => ({ key, text: `Opción ${key}` })),
    correctAnswer: "A",
    competency: null,
    evidence: null,
    contextTitle: null,
    contextText: null,
    contextImages: {},
    image: null,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// 1. Dominio
// ---------------------------------------------------------------------------

describe("option-rules · dominio", () => {
  describe("isValidOptionsRange", () => {
    it("acepta los rangos dentro de 2..8 con min <= max", () => {
      expect(isValidOptionsRange(2, 2)).toBe(true);
      expect(isValidOptionsRange(4, 4)).toBe(true);
      expect(isValidOptionsRange(2, 8)).toBe(true);
      expect(isValidOptionsRange(5, 8)).toBe(true);
    });

    it("rechaza rangos fuera de 2..8, invertidos o no enteros", () => {
      expect(isValidOptionsRange(1, 4)).toBe(false);
      expect(isValidOptionsRange(4, 9)).toBe(false);
      expect(isValidOptionsRange(0, 0)).toBe(false);
      expect(isValidOptionsRange(5, 4)).toBe(false);
      expect(isValidOptionsRange(2.5, 4)).toBe(false);
      expect(isValidOptionsRange(2, 4.5)).toBe(false);
    });
  });

  describe("resolveOptionsRange", () => {
    it("sin regla devuelve el default estricto (exactamente 4)", () => {
      expect(resolveOptionsRange(null)).toEqual({ min: 4, max: 4 });
      expect(DEFAULT_OPTIONS_RANGE).toEqual({ min: 4, max: 4 });
    });

    it("con regla devuelve el rango de la regla", () => {
      const rule = {
        id: "r1",
        institutionId: "i1",
        periodId: "p1",
        subjectId: "s1",
        minOptions: 2,
        maxOptions: 8,
        createdById: "m1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies OptionRule;
      expect(resolveOptionsRange(rule)).toEqual({ min: 2, max: 8 });
    });
  });

  describe("initialOptionsCount", () => {
    it("arranca con 4 opciones cuando el rango lo permite", () => {
      expect(initialOptionsCount({ min: 4, max: 4 })).toBe(4);
      expect(initialOptionsCount({ min: 2, max: 8 })).toBe(4);
    });

    it("ajusta el default al rango cuando no cabe", () => {
      expect(initialOptionsCount({ min: 5, max: 8 })).toBe(5);
      expect(initialOptionsCount({ min: 2, max: 3 })).toBe(3);
      expect(initialOptionsCount({ min: 6, max: 8 })).toBe(6);
    });
  });

  describe("isOptionsCountAllowed", () => {
    it("acepta los conteos dentro del rango", () => {
      expect(isOptionsCountAllowed(4, { min: 4, max: 4 })).toBe(true);
      expect(isOptionsCountAllowed(2, { min: 2, max: 8 })).toBe(true);
      expect(isOptionsCountAllowed(8, { min: 2, max: 8 })).toBe(true);
    });

    it("rechaza los conteos fuera del rango", () => {
      expect(isOptionsCountAllowed(3, { min: 4, max: 4 })).toBe(false);
      expect(isOptionsCountAllowed(5, { min: 4, max: 4 })).toBe(false);
      expect(isOptionsCountAllowed(1, { min: 2, max: 8 })).toBe(false);
      expect(isOptionsCountAllowed(4.5, { min: 2, max: 8 })).toBe(false);
    });
  });

  describe("mensajes", () => {
    it("describe el rango según sea exacto o un intervalo", () => {
      expect(describeOptionsRange({ min: 4, max: 4 })).toBe("exactamente 4 opciones");
      expect(describeOptionsRange({ min: 2, max: 8 })).toBe("entre 2 y 8 opciones");
    });

    it("el mensaje de error dice el rango y el conteo que se pasó", () => {
      expect(optionsCountErrorMessage(5, { min: 4, max: 4 })).toBe(
        "La pregunta debe tener exactamente 4 opciones (tiene 5).",
      );
      expect(optionsCountErrorMessage(3, { min: 2, max: 8 })).toBe(
        "La pregunta debe tener entre 2 y 8 opciones (tiene 3).",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Casos de uso de la regla (panel de la Prueba)
// ---------------------------------------------------------------------------

describe("option-rules · casos de uso", () => {
  function setup() {
    const rules = new FakeOptionRules();
    const periods = new FakePeriods();
    const subjects = new FakeSubjects();
    periods.items.push({
      id: "p1",
      institutionId: "i1",
      academicYearId: "ay1",
      name: "I Periodo",
      order: 1,
      startDate: new Date(),
      endDate: new Date(),
      isCurrent: true,
    });
    subjects.items.push({
      id: "s1",
      institutionId: "i1",
      name: "Matemáticas",
      code: "MAT",
      shortName: null,
    });
    return { rules, periods, subjects };
  }

  describe("CreateOptionRule", () => {
    it("crea la regla con el actor que la pidió", async () => {
      const { rules, periods, subjects } = setup();
      const result = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.createdById).toBe("m1");
      expect(result.value.minOptions).toBe(2);
      expect(result.value.maxOptions).toBe(8);
      expect(rules.items).toHaveLength(1);
    });

    it("solo el administrador de la institución (ECU_MASTER) puede crearla", async () => {
      const { rules, periods, subjects } = setup();
      const result = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: teacher,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      expect(result.ok).toBe(false);
      expect(rules.items).toHaveLength(0);
    });

    it("rechaza rangos inválidos", async () => {
      const { rules, periods, subjects } = setup();
      const result = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 1, maxOptions: 9 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("entre 2 y 8");
    });

    it("rechaza una prueba inexistente", async () => {
      const { rules, periods, subjects } = setup();
      const result = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "nope", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rechaza una asignatura inexistente", async () => {
      const { rules, periods, subjects } = setup();
      const result = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "nope", minOptions: 2, maxOptions: 8 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rechaza una segunda regla para la misma (prueba, asignatura)", async () => {
      const { rules, periods, subjects } = setup();
      const useCase = new CreateOptionRule(rules, periods, subjects);
      await useCase.execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      const dup = await useCase.execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 3, maxOptions: 5 },
      });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("CONFLICT");
    });

    it("traduce el P2002 de Postgres a conflicto", async () => {
      const { rules, periods, subjects } = setup();
      rules.createError = Object.assign(new Error("unique"), { code: "P2002" });
      const result = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("CONFLICT");
    });
  });

  describe("UpdateOptionRule", () => {
    it("actualiza el rango", async () => {
      const { rules, periods, subjects } = setup();
      const created = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      if (!created.ok) throw new Error("setup falló");
      const result = await new UpdateOptionRule(rules).execute({
        actor: master,
        id: created.value.id,
        data: { minOptions: 3, maxOptions: 5 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.minOptions).toBe(3);
      expect(result.value.maxOptions).toBe(5);
    });

    it("rechaza dejar el mínimo por encima del máximo ya guardado", async () => {
      const { rules, periods, subjects } = setup();
      const created = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 5, maxOptions: 8 },
      });
      if (!created.ok) throw new Error("setup falló");
      const result = await new UpdateOptionRule(rules).execute({
        actor: master,
        id: created.value.id,
        data: { maxOptions: 3 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("entre 2 y 8");
    });

    it("no encuentra una regla de otra institución", async () => {
      const { rules } = setup();
      const result = await new UpdateOptionRule(rules).execute({
        actor: master,
        id: "r999",
        data: { minOptions: 2 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("solo el administrador de la institución puede modificarla", async () => {
      const { rules, periods, subjects } = setup();
      const created = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      if (!created.ok) throw new Error("setup falló");
      const result = await new UpdateOptionRule(rules).execute({
        actor: teacher,
        id: created.value.id,
        data: { minOptions: 3 },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("DeleteOptionRule", () => {
    it("borra la regla", async () => {
      const { rules, periods, subjects } = setup();
      const created = await new CreateOptionRule(rules, periods, subjects).execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      if (!created.ok) throw new Error("setup falló");
      const result = await new DeleteOptionRule(rules).execute({
        actor: master,
        id: created.value.id,
      });
      expect(result.ok).toBe(true);
      expect(rules.items).toHaveLength(0);
    });

    it("no borra una regla de otra institución", async () => {
      const { rules } = setup();
      rules.items.push({
        id: "r1",
        institutionId: "i2",
        periodId: "p1",
        subjectId: "s1",
        minOptions: 2,
        maxOptions: 8,
        createdById: "m1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await new DeleteOptionRule(rules).execute({ actor: master, id: "r1" });
      expect(result.ok).toBe(false);
      expect(rules.items).toHaveLength(1);
    });
  });

  describe("ListOptionRulesByPeriod", () => {
    it("devuelve solo las reglas de la prueba y de la institución", async () => {
      const { rules, periods, subjects } = setup();
      const useCase = new CreateOptionRule(rules, periods, subjects);
      await useCase.execute({
        actor: master,
        data: { periodId: "p1", subjectId: "s1", minOptions: 2, maxOptions: 8 },
      });
      rules.items.push({
        id: "r2",
        institutionId: "i2",
        periodId: "p1",
        subjectId: "s1",
        minOptions: 3,
        maxOptions: 3,
        createdById: "m1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await new ListOptionRulesByPeriod(rules).execute({
        actor: master,
        periodId: "p1",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.institutionId).toBe("i1");
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Enforcement — bloqueo duro al guardar
// ---------------------------------------------------------------------------

describe("option-rules · enforcement al guardar", () => {
  describe("AddQuestion (formulación)", () => {
    it("bloquea una pregunta con 5 opciones cuando no hay regla (default estricto)", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const useCase = new AddQuestion(evaluations, new FakeEvaluationRules(), new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        sectionId: "sec1",
        data: makeQuestionData(5),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe("La pregunta debe tener exactamente 4 opciones (tiene 5).");
      expect(evaluations.addQuestionCalls).toBe(0);
    });

    it("bloquea una pregunta con 3 opciones cuando no hay regla", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const useCase = new AddQuestion(evaluations, new FakeEvaluationRules(), new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        sectionId: "sec1",
        data: makeQuestionData(3),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("exactamente 4 opciones");
    });

    it("permite 4 opciones (el default estricto)", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const useCase = new AddQuestion(evaluations, new FakeEvaluationRules(), new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        sectionId: "sec1",
        data: makeQuestionData(4),
      });
      expect(result.ok).toBe(true);
      expect(evaluations.addQuestionCalls).toBe(1);
    });

    it("permite 5 opciones cuando la regla de la (prueba, asignatura) lo permite", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const resolver = new FakeResolver();
      resolver.evaluationRanges["cs1"] = { min: 2, max: 8 };
      const useCase = new AddQuestion(evaluations, new FakeEvaluationRules(), resolver);
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        sectionId: "sec1",
        data: makeQuestionData(5),
      });
      expect(result.ok).toBe(true);
      expect(evaluations.addQuestionCalls).toBe(1);
    });

    it("bloquea 8 opciones si la regla topsa en 5", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const resolver = new FakeResolver();
      resolver.evaluationRanges["cs1"] = { min: 2, max: 5 };
      const useCase = new AddQuestion(evaluations, new FakeEvaluationRules(), resolver);
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        sectionId: "sec1",
        data: makeQuestionData(8),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe("La pregunta debe tener entre 2 y 5 opciones (tiene 8).");
    });
  });

  describe("UpdateQuestion (formulación)", () => {
    it("bloquea pasar a 5 opciones sin regla", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const useCase = new UpdateQuestion(evaluations, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        questionId: "q1",
        data: { options: makeQuestionData(5).options, correctAnswer: "A" },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("exactamente 4 opciones");
    });

    it("permite editar las opciones dentro del rango de la regla", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const resolver = new FakeResolver();
      resolver.evaluationRanges["cs1"] = { min: 2, max: 8 };
      const useCase = new UpdateQuestion(evaluations, resolver);
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        questionId: "q1",
        data: { options: makeQuestionData(5).options, correctAnswer: "A" },
      });
      expect(result.ok).toBe(true);
    });

    it("no revisa el rango cuando el docente no toca las opciones", async () => {
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const useCase = new UpdateQuestion(evaluations, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        questionId: "q1",
        data: { text: "Nuevo enunciado" },
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("CreateBankQuestion (banco)", () => {
    it("bloquea una pregunta de banco con 5 opciones si la asignatura no tiene regla", async () => {
      const bank = new FakeBank();
      const useCase = new CreateBankQuestion(bank, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        data: {
          subjectId: "s1",
          text: "Enunciado",
          options: makeQuestionData(5).options,
          correctAnswer: "A",
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("exactamente 4 opciones");
      expect(bank.created).toHaveLength(0);
    });

    it("permite la pregunta si el rango del banco lo permite", async () => {
      const bank = new FakeBank();
      const resolver = new FakeResolver();
      resolver.subjectRanges["s1"] = { min: 2, max: 8 };
      const useCase = new CreateBankQuestion(bank, resolver);
      const result = await useCase.execute({
        actor: teacher,
        data: {
          subjectId: "s1",
          text: "Enunciado",
          options: makeQuestionData(5).options,
          correctAnswer: "A",
        },
      });
      expect(result.ok).toBe(true);
      expect(bank.created).toHaveLength(1);
    });
  });

  describe("ImportBankQuestion (banco → formulación)", () => {
    it("bloquea si la pregunta del banco no cabe en el rango de la evaluación", async () => {
      const bank = new FakeBank();
      await bank.create("i1", "t1", {
        subjectId: "s1",
        text: "Enunciado",
        options: makeQuestionData(8).options,
        correctAnswer: "A",
      });
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const useCase = new ImportBankQuestion(bank, evaluations, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        bankQuestionId: "bq1",
        evaluationId: "e1",
        sectionId: "sec1",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toBe("La pregunta debe tener exactamente 4 opciones (tiene 8).");
      expect(evaluations.addQuestionCalls).toBe(0);
    });

    it("permite la importación si la evaluación tiene un rango más permisivo", async () => {
      const bank = new FakeBank();
      await bank.create("i1", "t1", {
        subjectId: "s1",
        text: "Enunciado",
        options: makeQuestionData(8).options,
        correctAnswer: "A",
      });
      const evaluations = new FakeEvaluations();
      evaluations.items.push(makeEvaluation());
      const resolver = new FakeResolver();
      resolver.evaluationRanges["cs1"] = { min: 2, max: 8 };
      const useCase = new ImportBankQuestion(bank, evaluations, resolver);
      const result = await useCase.execute({
        actor: teacher,
        bankQuestionId: "bq1",
        evaluationId: "e1",
        sectionId: "sec1",
      });
      expect(result.ok).toBe(true);
      expect(evaluations.addQuestionCalls).toBe(1);
    });
  });

  describe("ExportQuestionToBank (formulación → banco)", () => {
    it("bloquea si la pregunta no cabe en el rango del banco", async () => {
      const bank = new FakeBank();
      const evaluations = new FakeEvaluations();
      const evaluation = makeEvaluation();
      evaluations.items.push(evaluation);
      evaluations.detail = makeDetail(evaluation, [makeSection([makeQuestion(5)])]);
      const useCase = new ExportQuestionToBank(bank, evaluations, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        questionId: "q1",
        subjectId: "s1",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("exactamente 4 opciones");
      expect(bank.created).toHaveLength(0);
    });

    it("permite la exportación si el rango del banco lo permite", async () => {
      const bank = new FakeBank();
      const evaluations = new FakeEvaluations();
      const evaluation = makeEvaluation();
      evaluations.items.push(evaluation);
      evaluations.detail = makeDetail(evaluation, [makeSection([makeQuestion(5)])]);
      const resolver = new FakeResolver();
      resolver.subjectRanges["s1"] = { min: 2, max: 8 };
      const useCase = new ExportQuestionToBank(bank, evaluations, resolver);
      const result = await useCase.execute({
        actor: teacher,
        evaluationId: "e1",
        questionId: "q1",
        subjectId: "s1",
      });
      expect(result.ok).toBe(true);
      expect(bank.created).toHaveLength(1);
    });
  });

  describe("ImportQuestions (importación masiva)", () => {
    it("da de alta las que caben y reporta las que no, sin abortar", async () => {
      const evaluations = new FakeEvaluations();
      const evaluation = makeEvaluation();
      evaluations.items.push(evaluation);
      evaluations.detail = makeDetail(evaluation, [makeSection()]);
      const bank = new FakeBank();
      const questions = [
        makeParsedQuestion(4, "Pregunta 1"),
        makeParsedQuestion(5, "Pregunta 2"),
        makeParsedQuestion(4, "Pregunta 3"),
      ];
      const useCase = new ImportQuestions(evaluations, bank, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        questions,
        destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.imported).toBe(2);
      expect(result.value.problems).toHaveLength(1);
      // El índice del problema es el de la lista revisada (0-based): la
      // segunda pregunta.
      expect(result.value.problems[0]?.index).toBe(1);
      expect(result.value.problems[0]?.message).toContain("exactamente 4 opciones");
      expect(evaluations.addQuestionCalls).toBe(2);
    });

    it("falla si ninguna pregunta cabe en el rango", async () => {
      const evaluations = new FakeEvaluations();
      const evaluation = makeEvaluation();
      evaluations.items.push(evaluation);
      evaluations.detail = makeDetail(evaluation, [makeSection()]);
      const bank = new FakeBank();
      const useCase = new ImportQuestions(evaluations, bank, new FakeResolver());
      const result = await useCase.execute({
        actor: teacher,
        questions: [makeParsedQuestion(5, "Pregunta 1")],
        destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
      });
      expect(result.ok).toBe(false);
      expect(evaluations.addQuestionCalls).toBe(0);
    });

    it("usa el rango de la asignatura cuando el destino es el banco", async () => {
      const evaluations = new FakeEvaluations();
      const bank = new FakeBank();
      const resolver = new FakeResolver();
      resolver.subjectRanges["s1"] = { min: 2, max: 8 };
      const useCase = new ImportQuestions(evaluations, bank, resolver);
      const result = await useCase.execute({
        actor: teacher,
        questions: [makeParsedQuestion(5, "Pregunta 1")],
        destination: { kind: "bank", subjectId: "s1" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.imported).toBe(1);
      expect(result.value.problems).toHaveLength(0);
    });
  });
});
