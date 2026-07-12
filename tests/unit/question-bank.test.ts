import { describe, expect, it } from "vitest";
import {
  CreateBankQuestion,
  ImportBankQuestion,
} from "@/modules/question-bank/application/manage-bank";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  BankQuestion,
  BankQuestionFilters,
  BankQuestionRepository,
  CreateBankQuestionData,
} from "@/modules/question-bank/domain/bank-question";
import type {
  CreateQuestionData,
  Evaluation,
  EvaluationDetail,
  EvaluationListItem,
  EvaluationRepository,
  EvaluationSection,
  Question,
} from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";

class FakeBank implements BankQuestionRepository {
  items: BankQuestion[] = [];
  async create(institutionId: string, createdBy: string, data: CreateBankQuestionData) {
    const q: BankQuestion = {
      id: `b-${this.items.length + 1}`,
      institutionId,
      subjectId: data.subjectId,
      subjectName: "Mat",
      text: data.text,
      options: data.options,
      correctAnswer: data.correctAnswer,
      justification: data.justification ?? null,
      soloLevel: data.soloLevel ?? null,
      menComponent: data.menComponent ?? null,
      difficulty: data.difficulty ?? "MEDIUM",
      tags: data.tags ?? [],
      isPersonal: data.isPersonal ?? false,
      createdBy,
    };
    this.items.push(q);
    return q;
  }
  async findVisible(institutionId: string, userId: string, id: string) {
    return (
      this.items.find(
        (q) =>
          q.id === id &&
          q.institutionId === institutionId &&
          (!q.isPersonal || q.createdBy === userId),
      ) ?? null
    );
  }
  async search(institutionId: string, userId: string, _f: BankQuestionFilters) {
    return this.items.filter(
      (q) => q.institutionId === institutionId && (!q.isPersonal || q.createdBy === userId),
    );
  }
}

class FakeEvaluations implements EvaluationRepository {
  constructor(private readonly evaluation: Evaluation) {}
  added: CreateQuestionData[] = [];
  async create(): Promise<Evaluation> {
    throw new Error("no usado");
  }
  async findById(_i: string, id: string) {
    return id === this.evaluation.id ? this.evaluation : null;
  }
  async getDetail(): Promise<EvaluationDetail | null> {
    return null;
  }
  async findByTeacher(): Promise<EvaluationListItem[]> {
    return [];
  }
  async findByInstitution(): Promise<EvaluationListItem[]> {
    return [];
  }
  async addSection(): Promise<EvaluationSection> {
    throw new Error("no usado");
  }
  async addQuestion(
    _i: string,
    _e: string,
    _s: string,
    data: CreateQuestionData,
  ): Promise<Question> {
    this.added.push(data);
    return {
      id: `q-${this.added.length}`,
      number: this.added.length,
      text: data.text,
      image: null,
      options: data.options,
      correctAnswer: data.correctAnswer,
      justification: null,
      weight: 1,
      soloLevel: data.soloLevel ?? null,
      menComponent: data.menComponent ?? null,
    };
  }
  async updateStatus(_i: string, _id: string, _s: EvaluationStatus) {}
  async createNewVersion(): Promise<Evaluation> {
    throw new Error("no usado");
  }
}

const teacher: AuthenticatedUser = { userId: "t1", institutionId: "i1", roles: ["TEACHER"] };
const other: AuthenticatedUser = { userId: "t2", institutionId: "i1", roles: ["TEACHER"] };

const bankData = (over: Partial<CreateBankQuestionData> = {}): CreateBankQuestionData => ({
  subjectId: "s1",
  text: "¿2+2?",
  options: (["A", "B", "C", "D"] as const).map((key) => ({ key, text: key })),
  correctAnswer: "B",
  ...over,
});

const draft: Evaluation = {
  id: "e1",
  institutionId: "i1",
  title: "P",
  description: null,
  version: 1,
  status: "DRAFT",
  courseSubjectId: "cs1",
  academicYearId: "ay1",
  periodId: null,
  teacherId: "t1",
  bookletNumber: null,
  totalQuestions: 0,
};

describe("CreateBankQuestion", () => {
  it("crea con forma válida", async () => {
    const r = await new CreateBankQuestion(new FakeBank()).execute({
      actor: teacher,
      data: bankData(),
    });
    expect(r.ok).toBe(true);
  });
  it("rechaza opciones inválidas", async () => {
    const r = await new CreateBankQuestion(new FakeBank()).execute({
      actor: teacher,
      data: bankData({ options: [{ key: "A", text: "a" }] }),
    });
    expect(r.ok).toBe(false);
  });
});

describe("ImportBankQuestion (copia independiente)", () => {
  it("importa a la evaluación con bankOriginId y no comparte referencia", async () => {
    const bank = new FakeBank();
    const source = await bank.create("i1", "t1", bankData());
    const evals = new FakeEvaluations(draft);
    const uc = new ImportBankQuestion(bank, evals);

    const r = await uc.execute({
      actor: teacher,
      bankQuestionId: source.id,
      evaluationId: "e1",
      sectionId: "sec1",
    });
    expect(r.ok).toBe(true);
    expect(evals.added).toHaveLength(1);
    expect(evals.added[0]!.bankOriginId).toBe(source.id);
    // Editar la copia no toca el banco.
    expect(bank.items[0]!.correctAnswer).toBe("B");
  });

  it("rechaza importar a una evaluación ajena", async () => {
    const bank = new FakeBank();
    const source = await bank.create("i1", "t1", bankData());
    const uc = new ImportBankQuestion(bank, new FakeEvaluations(draft));
    const r = await uc.execute({
      actor: other,
      bankQuestionId: source.id,
      evaluationId: "e1",
      sectionId: "sec1",
    });
    expect(r.ok).toBe(false);
  });

  it("no importa una pregunta personal de otro usuario", async () => {
    const bank = new FakeBank();
    const source = await bank.create("i1", "t2", bankData({ isPersonal: true }));
    const uc = new ImportBankQuestion(bank, new FakeEvaluations(draft));
    const r = await uc.execute({
      actor: teacher,
      bankQuestionId: source.id,
      evaluationId: "e1",
      sectionId: "sec1",
    });
    expect(r.ok).toBe(false); // no visible para t1
  });
});
