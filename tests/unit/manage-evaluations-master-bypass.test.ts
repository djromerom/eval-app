import { beforeEach, describe, expect, it } from "vitest";
import {
  AddQuestion,
  AddSection,
  DeleteQuestion,
  DeleteSection,
  DuplicateQuestion,
  ReorderQuestions,
  UpdateQuestion,
  UpdateSection,
} from "@/modules/evaluations/application/manage-evaluations";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateEvaluationData,
  CreateQuestionData,
  Evaluation,
  EvaluationDetail,
  EvaluationListItem,
  EvaluationRepository,
  EvaluationSection,
  Question,
} from "@/modules/evaluations/domain/evaluation";
import type { EvaluationRuleRepository } from "@/modules/evaluation-rules/domain/evaluation-rule";

/**
 * Cobertura del bypass de ECU_MASTER en `loadOwnedDraft`:
 *  El super admin (ECU_MASTER) puede editar el contenido de cualquier
 *  evaluación DRAFT de su institución aunque NO sea el autor. El teacherId
 *  original se conserva (el admin "colabora", no se apropia).
 *
 * Cada use case se cubre con 3 variantes:
 *   - ECU_MASTER: edición permitida sobre DRAFT ajena.
 *   - TEACHER B (no autor): sigue recibiendo FORBIDDEN/VALIDATION.
 *   - ECU_LIDER: NO recibe el permiso (este sprint es solo para ECU_MASTER).
 *   - Estado ≠ DRAFT: ECU_MASTER tampoco puede editar (mismo check que autor).
 */

class FakeEvaluations implements EvaluationRepository {
  items: Evaluation[] = [];
  questionSections: Map<string, string> = new Map();
  updated: Array<{ kind: "section" | "question"; id: string }> = [];
  deleted: Array<{ kind: "section" | "question"; id: string }> = [];
  /** Sembrador para que los tests pueblen la sección dueña de cada pregunta. */
  seed(questionId: string, sectionId: string): void {
    this.questionSections.set(questionId, sectionId);
  }

  async create(institutionId: string, teacherId: string, data: CreateEvaluationData) {
    const e: Evaluation = {
      id: `e-${this.items.length + 1}`,
      institutionId,
      teacherId,
      title: data.title,
      description: data.description ?? null,
      version: 1,
      status: "DRAFT",
      courseSubjectId: data.courseSubjectId,
      academicYearId: "ay1",
      periodId: data.periodId ?? null,
      bookletNumber: data.bookletNumber ?? null,
      bookletTypeId: data.bookletTypeId ?? null,
      totalQuestions: 0,
      durationMinutes: data.durationMinutes ?? null,
      theme: { questionColumns: 2 },
    };
    this.items.push(e);
    return e;
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((e) => e.institutionId === institutionId && e.id === id) ?? null;
  }
  async getDetail(): Promise<EvaluationDetail | null> {
    return null;
  }
  async findByTeacher(): Promise<EvaluationListItem[]> {
    return [];
  }
  async findByCourseIds(): Promise<EvaluationListItem[]> {
    return [];
  }
  async findByInstitution(): Promise<EvaluationListItem[]> {
    return [];
  }
  async addSection(): Promise<EvaluationSection> {
    return { id: "sec-new", title: null, content: null, order: 0, questions: [] };
  }
  async updateSection(_i: string, _e: string, sectionId: string): Promise<EvaluationSection> {
    this.updated.push({ kind: "section", id: sectionId });
    return { id: sectionId, title: null, content: null, order: 0, questions: [] };
  }
  async deleteSection(_i: string, _e: string, sectionId: string): Promise<void> {
    this.deleted.push({ kind: "section", id: sectionId });
    for (const [qid, sid] of this.questionSections) {
      if (sid === sectionId) this.questionSections.delete(qid);
    }
  }
  async updateQuestion(_i: string, _e: string, questionId: string): Promise<Question> {
    this.updated.push({ kind: "question", id: questionId });
    return {
      id: questionId,
      number: 1,
      text: "t",
      image: null,
      sectionId: "sec1",
      options: [],
      correctAnswer: "A",
      justification: null,
      weight: 1,
      soloLevel: null,
      menComponent: null,
      competency: null,
    };
  }
  async findQuestionSectionId(_i: string, _e: string, questionId: string): Promise<string | null> {
    return this.questionSections.get(questionId) ?? null;
  }
  async deleteQuestion(_i: string, _e: string, questionId: string): Promise<void> {
    this.deleted.push({ kind: "question", id: questionId });
    this.questionSections.delete(questionId);
  }
  async countQuestionsInSection(sectionId: string): Promise<number> {
    let n = 0;
    for (const sid of this.questionSections.values()) if (sid === sectionId) n++;
    return n;
  }
  async reorderQuestions(): Promise<void> {
    /* no-op en este fake */
  }
  async duplicateQuestion(_i: string, _e: string, questionId: string): Promise<void> {
    this.updated.push({ kind: "question", id: questionId });
  }
  async addQuestion(
    _i: string,
    _e: string,
    _sectionId: string,
    data: CreateQuestionData,
  ): Promise<Question> {
    return {
      id: `q-${Math.random().toString(36).slice(2, 8)}`,
      number: 99,
      text: data.text,
      image: null,
      sectionId: _sectionId,
      options: data.options as {
        key: import("@/modules/evaluations/domain/evaluation").AnswerKey;
        text: unknown;
      }[],
      correctAnswer: data.correctAnswer,
      justification: data.justification ?? null,
      weight: data.weight ?? 1,
      soloLevel: null,
      menComponent: null,
      competency: data.competency ?? null,
    };
  }
  async findCourseIdByEvaluation(): Promise<string | null> {
    return null;
  }
  async updateSettings(): Promise<Evaluation> {
    throw new Error("no usado");
  }
  async createNewVersion(): Promise<Evaluation> {
    throw new Error("no usado");
  }
  async updateStatus(_i: string, _e: string, status: Evaluation["status"]): Promise<void> {
    const e = this.items.find((x) => x.id === _e);
    if (e) e.status = status;
  }
  async existsByCourseSubjectPeriodBookletTypeYear(): Promise<boolean> {
    return false;
  }
}

class FakeEvaluationRules implements EvaluationRuleRepository {
  async findByCourseSubjectPeriodBookletType(): Promise<null> {
    return null;
  }
  async findByInstitution(): Promise<[]> {
    return [];
  }
  async findById(): Promise<null> {
    return null;
  }
  async listByPeriod(): Promise<[]> {
    return [];
  }
  async listByInstitution(): Promise<[]> {
    return [];
  }
  async findForEvaluation(): Promise<null> {
    return null;
  }
  async list(): Promise<[]> {
    return [];
  }
  async create(): Promise<never> {
    throw new Error("no usado");
  }
  async update(): Promise<never> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    /* no-op */
  }
}

const teacher: AuthenticatedUser = { userId: "t1", institutionId: "i1", roles: ["TEACHER"] };
const master: AuthenticatedUser = { userId: "admin", institutionId: "i1", roles: ["ECU_MASTER"] };
const lider: AuthenticatedUser = { userId: "lider", institutionId: "i1", roles: ["ECU_LIDER"] };
const otherTeacher: AuthenticatedUser = { userId: "t2", institutionId: "i1", roles: ["TEACHER"] };

const questionSeed = {
  text: "Enunciado",
  options: [
    { key: "A" as const, text: "a" },
    { key: "B" as const, text: "b" },
    { key: "C" as const, text: "c" },
    { key: "D" as const, text: "d" },
  ],
  correctAnswer: "A" as const,
  weight: 1,
};

describe("ECU_MASTER edit bypass (loadOwnedDraft)", () => {
  let repo: FakeEvaluations;
  let evalId: string;

  beforeEach(async () => {
    repo = new FakeEvaluations();
    const created = await repo.create("i1", teacher.userId, {
      title: "Formulación del docente",
      courseSubjectId: "cs1",
    });
    evalId = created.id;
  });

  describe("AddSection", () => {
    it("ECU_MASTER puede agregar sección a DRAFT ajena", async () => {
      const r = await new AddSection(repo).execute({
        actor: master,
        evaluationId: evalId,
        data: { title: "Contexto del admin" },
      });
      expect(r.ok).toBe(true);
    });

    it("TEACHER B (no autor) sigue recibiendo VALIDATION", async () => {
      const r = await new AddSection(repo).execute({
        actor: otherTeacher,
        evaluationId: evalId,
        data: { title: "Hackeado" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    });

    it("ECU_LIDER NO recibe el permiso (este sprint es solo ECU_MASTER)", async () => {
      const r = await new AddSection(repo).execute({
        actor: lider,
        evaluationId: evalId,
        data: { title: "Lider" },
      });
      expect(r.ok).toBe(false);
      // ECU_LIDER pasa el role gate (TEACHER+ECU_LIDER+ECU_MASTER) pero
      // loadOwnedDraft lo rechaza por NO ser autor y NO ser ECU_MASTER.
      // Mensaje sale como ValidationError (mismo tipo que TEACHER B).
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    });
  });

  describe("UpdateSection", () => {
    it("ECU_MASTER puede editar sección de DRAFT ajena", async () => {
      const r = await new UpdateSection(repo).execute({
        actor: master,
        evaluationId: evalId,
        sectionId: "s1",
        data: { title: "Editado por admin" },
      });
      expect(r.ok).toBe(true);
      expect(repo.updated).toEqual([{ kind: "section", id: "s1" }]);
    });

    it("ECU_MASTER NO puede editar si la evaluación está en IN_REVIEW", async () => {
      await repo.updateStatus("i1", evalId, "IN_REVIEW");
      const r = await new UpdateSection(repo).execute({
        actor: master,
        evaluationId: evalId,
        sectionId: "s1",
        data: { title: "Tarde" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    });
  });

  describe("DeleteSection", () => {
    it("ECU_MASTER puede borrar sección de DRAFT ajena", async () => {
      const r = await new DeleteSection(repo).execute({
        actor: master,
        evaluationId: evalId,
        sectionId: "s1",
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("AddQuestion", () => {
    it("ECU_MASTER puede agregar pregunta a DRAFT ajena", async () => {
      const r = await new AddQuestion(repo, new FakeEvaluationRules()).execute({
        actor: master,
        evaluationId: evalId,
        sectionId: "sec1",
        data: questionSeed,
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("UpdateQuestion", () => {
    it("ECU_MASTER puede editar pregunta de DRAFT ajena", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: master,
        evaluationId: evalId,
        questionId: "q1",
        data: { text: "Editado por admin" },
      });
      expect(r.ok).toBe(true);
      expect(repo.updated).toEqual([{ kind: "question", id: "q1" }]);
    });
  });

  describe("DeleteQuestion", () => {
    it("ECU_MASTER puede borrar pregunta de DRAFT ajena", async () => {
      repo.seed("q1", "sec1");
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: master,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("DuplicateQuestion", () => {
    it("ECU_MASTER puede duplicar pregunta de DRAFT ajena", async () => {
      const r = await new DuplicateQuestion(repo, new FakeEvaluationRules()).execute({
        actor: master,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("ReorderQuestions", () => {
    it("ECU_MASTER puede reordenar preguntas de DRAFT ajena", async () => {
      const r = await new ReorderQuestions(repo).execute({
        actor: master,
        evaluationId: evalId,
        sectionId: "sec1",
        orderedQuestionIds: ["q1"],
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("Conservación de teacherId", () => {
    it("el teacherId original NO cambia tras múltiples ediciones como ECU_MASTER", async () => {
      await new AddSection(repo).execute({
        actor: master,
        evaluationId: evalId,
        data: { title: "Agregada por admin" },
      });
      await new UpdateSection(repo).execute({
        actor: master,
        evaluationId: evalId,
        sectionId: "s1",
        data: { title: "Editada por admin" },
      });
      const after = await repo.findById("i1", evalId);
      expect(after?.teacherId).toBe(teacher.userId);
      expect(after?.status).toBe("DRAFT");
    });
  });
});
