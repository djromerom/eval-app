import { beforeEach, describe, expect, it } from "vitest";

import type { Evaluation, EvaluationRepository } from "@/modules/evaluations/domain/evaluation";
import {
  AddQuestion,
  DeleteQuestion,
  DuplicateQuestion,
} from "@/modules/evaluations/application/manage-evaluations";
import { ChangeEvaluationStatus } from "@/modules/evaluations/application/change-status";
import type {
  NotificationMessage,
  NotificationSender,
} from "@/modules/notifications/domain/notification";
import type {
  EvaluationRule,
  EvaluationRuleRepository,
} from "@/modules/evaluation-rules/domain/evaluation-rule";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { ValidationError } from "@/shared/domain/result";
import type {
  LeaderAssignment,
  LeaderAssignmentRepository,
} from "@/modules/leader-assignments/domain/leader-assignment";

// ---------------------------------------------------------------------------
// Actores
// ---------------------------------------------------------------------------

const teacher: AuthenticatedUser = { userId: "t1", institutionId: "i1", roles: ["TEACHER"] };
const coordinator: AuthenticatedUser = {
  userId: "c1",
  institutionId: "i1",
  roles: ["ECU_LIDER"],
};

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/**
 * Repo de evaluaciones MINIMALISTA que implementa la interfaz completa
 * `EvaluationRepository`. Solo las operaciones que ejercitan las gates de
 * reglas tienen comportamiento real; el resto son stubs tipados para que
 * `tsc --noEmit` pase. Evita `as unknown as EvaluationRepository` en los
 * callsites de los use cases.
 */
class FakeEvaluations implements EvaluationRepository {
  items: Evaluation[] = [];
  addQuestionCalls = 0;
  deleteQuestionCalls = 0;
  duplicateQuestionCalls = 0;
  statusUpdates: Evaluation["status"][] = [];

  async findById(institutionId: string, id: string) {
    return this.items.find((e) => e.institutionId === institutionId && e.id === id) ?? null;
  }
  async addQuestion(_i: string, evaluationId: string, _sectionId: string, _data: never) {
    this.addQuestionCalls += 1;
    const e = this.items.find((x) => x.id === evaluationId)!;
    e.totalQuestions += 1;
    return {} as never;
  }
  // Stubs tipados — los use cases de estos tests no inspeccionan el return,
  // solo lo dejamos con la shape correcta para `tsc --noEmit strict`.
  async updateQuestion() {
    return {} as never;
  }
  async deleteQuestion(_i: string, evaluationId: string, _qid: string) {
    this.deleteQuestionCalls += 1;
    const e = this.items.find((x) => x.id === evaluationId)!;
    e.totalQuestions = Math.max(0, e.totalQuestions - 1);
  }
  async duplicateQuestion(_i: string, evaluationId: string, _qid: string) {
    this.duplicateQuestionCalls += 1;
    const e = this.items.find((x) => x.id === evaluationId)!;
    e.totalQuestions += 1;
  }
  async findQuestionSectionId() {
    return "sec1";
  }
  async countQuestionsInSection() {
    return 1;
  }
  async deleteSection() {
    /* noop */
  }
  async updateStatus(_i: string, id: string, status: Evaluation["status"]) {
    const e = this.items.find((x) => x.id === id)!;
    e.status = status;
    this.statusUpdates.push(status);
  }

  // Métodos de `EvaluationRepository` no ejercitados por estos tests.
  // Stubs tipados con retornos neutrales; si un test futuro los necesita,
  // basta con sobreescribirlos en el setup. Los `_` antes de los parámetros
  // silencian "declared but never read" en cada stub.
  async create(_i: string, _t: string, _d: never): Promise<Evaluation> {
    throw new Error("noop");
  }
  async getDetail(_i: string, _id: string) {
    return null;
  }
  async findByTeacher(_i: string, _t: string) {
    return [];
  }
  async findByInstitution(_i: string) {
    return [];
  }
  async findByCourseIds(_i: string, _courseIds: string[]) {
    return [];
  }
  async addSection(_i: string, _eid: string, _d: never): Promise<never> {
    return {} as never;
  }
  async updateSection(_i: string, _eid: string, _sid: string, _d: never): Promise<never> {
    return {} as never;
  }
  async reorderQuestions(_i: string, _eid: string, _sid: string, _ids: string[]) {
    /* noop */
  }
  async updateSettings(_i: string, _id: string, _d: never): Promise<never> {
    return {} as never;
  }
  async createNewVersion(_i: string, _id: string): Promise<never> {
    return {} as never;
  }
  /** Scope check del líder: por defecto la evaluación cae en `c1`, que
   *  coincide con el curso asignado al coordinador en `FakeLeaderAssignments`.
   *  Tests específicos de scope viven en `change-status-scope.test.ts`. */
  async findCourseIdByEvaluation(_i: string, _id: string): Promise<string | null> {
    return "c1";
  }
  async existsByCourseSubjectPeriodBookletTypeYear(
    _i: string,
    _cs: string,
    _p: string | null,
    _b: string | null,
    _ay: string,
  ) {
    return false;
  }
}

/** Repo de reglas con `findForEvaluation` configurable por test. */
class FakeRules implements EvaluationRuleRepository {
  rule: EvaluationRule | null = null;
  async findForEvaluation() {
    return this.rule;
  }

  // Métodos no ejercitados por estos tests — stubs tipados para `tsc strict`.
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

class FakeSender implements NotificationSender {
  async send(_m: NotificationMessage) {
    /* noop */
  }
}

/** Stub mínimo de LeaderAssignmentRepository para los tests de flujo.
 *  Por defecto el coordinador está asignado a `c1`, que coincide con el
 *  courseId que devuelve `FakeEvaluations.findCourseIdByEvaluation`. */
class FakeLeaderAssignments implements LeaderAssignmentRepository {
  assigned: string[] = ["c1"];
  async listAssignedCourseIds(_i: string, _u: string): Promise<string[]> {
    return this.assigned;
  }
  async assign(): Promise<void> {
    /* noop */
  }
  async unassign(): Promise<void> {
    /* noop */
  }
  async isAssigned(): Promise<boolean> {
    return false;
  }
  async listAssignments(): Promise<LeaderAssignment[]> {
    return [];
  }
}

const baseEvaluation: Evaluation = {
  id: "e1",
  institutionId: "i1",
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
  totalQuestions: 50,
  durationMinutes: null,
  theme: null,
};

const baseRule: EvaluationRule = {
  id: "r1",
  institutionId: "i1",
  periodId: "p1",
  courseId: "c1",
  subjectId: "s1",
  bookletTypeId: "bt1",
  exactQuestions: 50,
  createdById: "u1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ===========================================================================
// AddQuestion
// ===========================================================================

describe("Enforcement AddQuestion", () => {
  let repo: FakeEvaluations;
  let rules: FakeRules;

  beforeEach(() => {
    repo = new FakeEvaluations();
    rules = new FakeRules();
    repo.items.push({ ...baseEvaluation, totalQuestions: 50 });
  });

  it("bloquea agregar cuando current = exact (regla = 50, current = 50)", async () => {
    rules.rule = baseRule;
    const r = await new AddQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      sectionId: "sec1",
      data: {
        text: "¿?",
        options: [
          { key: "A", text: "A" },
          { key: "B", text: "B" },
        ],
        correctAnswer: "A",
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(ValidationError);
    expect(r.error.message).toMatch(/exactamente 50/);
    expect(repo.addQuestionCalls).toBe(0);
  });

  it("permite agregar cuando current < exact (regla = 50, current = 49)", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 49;
    const r = await new AddQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      sectionId: "sec1",
      data: {
        text: "¿?",
        options: [
          { key: "A", text: "A" },
          { key: "B", text: "B" },
        ],
        correctAnswer: "A",
      },
    });
    expect(r.ok).toBe(true);
    expect(repo.addQuestionCalls).toBe(1);
  });

  it("permite agregar cuando no hay regla (modo libre)", async () => {
    rules.rule = null;
    const r = await new AddQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      sectionId: "sec1",
      data: {
        text: "¿?",
        options: [
          { key: "A", text: "A" },
          { key: "B", text: "B" },
        ],
        correctAnswer: "A",
      },
    });
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// DeleteQuestion
// ===========================================================================

describe("Enforcement DeleteQuestion", () => {
  let repo: FakeEvaluations;
  let rules: FakeRules;

  beforeEach(() => {
    repo = new FakeEvaluations();
    rules = new FakeRules();
    repo.items.push({ ...baseEvaluation, totalQuestions: 50 });
  });

  it("permite eliminar cuando current = exact (regla = 50, current = 50) — gate inferior removido por el docente (cf1ce47)", async () => {
    rules.rule = baseRule;
    const r = await new DeleteQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      questionId: "q1",
    });
    // cf1ce47: el docente removió la rama `delta === -1 && next < rule.exactQuestions`
    // en checkExactCount. Ahora el borrado se permite aun cuando la evaluación
    // esté exactamente en el conteo de la regla (el publish sigue bloqueado por
    // ChangeEvaluationStatus si después del borrado no cumple la regla).
    expect(r.ok).toBe(true);
    expect(repo.deleteQuestionCalls).toBe(1);
  });

  it("permite eliminar cuando current > exact (regla = 50, current = 51)", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 51;
    const r = await new DeleteQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      questionId: "q1",
    });
    expect(r.ok).toBe(true);
    expect(repo.deleteQuestionCalls).toBe(1);
  });

  it("permite eliminar cuando no hay regla (modo libre)", async () => {
    rules.rule = null;
    const r = await new DeleteQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      questionId: "q1",
    });
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// DuplicateQuestion
// ===========================================================================

describe("Enforcement DuplicateQuestion", () => {
  let repo: FakeEvaluations;
  let rules: FakeRules;

  beforeEach(() => {
    repo = new FakeEvaluations();
    rules = new FakeRules();
    repo.items.push({ ...baseEvaluation, totalQuestions: 50 });
  });

  it("bloquea duplicar cuando current = exact", async () => {
    rules.rule = baseRule;
    const r = await new DuplicateQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      questionId: "q1",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(ValidationError);
    expect(repo.duplicateQuestionCalls).toBe(0);
  });

  it("permite duplicar cuando current < exact", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 49;
    const r = await new DuplicateQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      questionId: "q1",
    });
    expect(r.ok).toBe(true);
    expect(repo.duplicateQuestionCalls).toBe(1);
  });

  it("permite duplicar cuando no hay regla", async () => {
    rules.rule = null;
    const r = await new DuplicateQuestion(repo, rules).execute({
      actor: teacher,
      evaluationId: "e1",
      questionId: "q1",
    });
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// ChangeEvaluationStatus
// ===========================================================================

describe("Enforcement ChangeEvaluationStatus", () => {
  let repo: FakeEvaluations;
  let rules: FakeRules;
  let workflow: ChangeEvaluationStatus;

  beforeEach(() => {
    repo = new FakeEvaluations();
    rules = new FakeRules();
    workflow = new ChangeEvaluationStatus(
      repo,
      new FakeSender(),
      { coordinatorIds: async () => ["c1"] },
      rules,
      new FakeLeaderAssignments(),
    );
    repo.items.push({ ...baseEvaluation });
  });

  it("bloquea IN_REVIEW con regla y current != exact", async () => {
    rules.rule = baseRule; // exact=50
    repo.items[0]!.totalQuestions = 49;
    const r = await workflow.execute({
      actor: teacher,
      evaluationId: "e1",
      to: "IN_REVIEW",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(ValidationError);
    expect(r.error.message).toMatch(/exactamente 50/);
    expect(repo.statusUpdates).toEqual([]);
  });

  it("permite IN_REVIEW con regla y current = exact", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 50;
    const r = await workflow.execute({
      actor: teacher,
      evaluationId: "e1",
      to: "IN_REVIEW",
    });
    expect(r.ok).toBe(true);
    expect(repo.statusUpdates).toEqual(["IN_REVIEW"]);
  });

  it("permite IN_REVIEW sin regla (modo libre)", async () => {
    rules.rule = null;
    repo.items[0]!.totalQuestions = 49;
    const r = await workflow.execute({
      actor: teacher,
      evaluationId: "e1",
      to: "IN_REVIEW",
    });
    expect(r.ok).toBe(true);
  });

  it("bloquea PUBLISHED con regla y current != exact", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 51;
    const r = await workflow.execute({
      actor: coordinator,
      evaluationId: "e1",
      to: "PUBLISHED",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(ValidationError);
  });

  it("permite PUBLISHED con regla y current = exact", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 50;
    const r = await workflow.execute({
      actor: coordinator,
      evaluationId: "e1",
      to: "PUBLISHED",
    });
    expect(r.ok).toBe(true);
    expect(repo.statusUpdates).toEqual(["PUBLISHED"]);
  });

  it("NO bloquea rechazo (IN_REVIEW → DRAFT)", async () => {
    rules.rule = baseRule;
    repo.items[0]!.totalQuestions = 49;
    repo.items[0]!.status = "IN_REVIEW";
    const r = await workflow.execute({
      actor: coordinator,
      evaluationId: "e1",
      to: "DRAFT",
      comment: "Volver a borrador",
    });
    expect(r.ok).toBe(true);
    expect(repo.statusUpdates).toEqual(["DRAFT"]);
  });
});
