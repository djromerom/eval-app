import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateQuestionData,
  Evaluation,
  EvaluationDetail,
  EvaluationListItem,
  EvaluationRepository,
  EvaluationSection,
  Question,
  UpdateEvaluationSettingsData,
} from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import type {
  BankQuestion,
  BankQuestionRepository,
  CreateBankQuestionData,
} from "@/modules/question-bank/domain/bank-question";
import {
  normalizeOptionKeys,
  partitionParsedQuestions,
  validateParsedQuestion,
  type ParsedQuestion,
} from "@/modules/question-import/domain/parsed-question";
import { ImportQuestions } from "@/modules/question-import/application/import-questions";
import { QuestionsFromEvaluation } from "@/modules/question-import/application/questions-from-evaluation";

const teacher: AuthenticatedUser = {
  userId: "t1",
  institutionId: "i1",
  roles: ["TEACHER"],
};

const otherTeacher: AuthenticatedUser = {
  userId: "t2",
  institutionId: "i1",
  roles: ["TEACHER"],
};

// ---------- fakes ----------

class FakeBank implements BankQuestionRepository {
  items: BankQuestion[] = [];
  createManyCalls: CreateBankQuestionData[][] = [];
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
      competency: data.competency ?? null,
      evidence: data.evidence ?? null,
      difficulty: data.difficulty ?? "MEDIUM",
      tags: data.tags ?? [],
      isPersonal: data.isPersonal ?? false,
      createdBy,
    };
    this.items.push(q);
    return q;
  }
  async createMany(
    institutionId: string,
    createdBy: string,
    data: CreateBankQuestionData[],
  ): Promise<number> {
    this.createManyCalls.push(data);
    for (const d of data) {
      await this.create(institutionId, createdBy, d);
    }
    return data.length;
  }
  async findVisible() {
    return null;
  }
  async search() {
    return this.items;
  }
}

class FakeEvaluations implements EvaluationRepository {
  detail: EvaluationDetail | null = null;
  added: CreateQuestionData[] = [];
  async create(): Promise<Evaluation> {
    throw new Error("no usado");
  }
  async findById(): Promise<Evaluation | null> {
    return this.detail;
  }
  async getDetail(): Promise<EvaluationDetail | null> {
    return this.detail;
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
      competency: data.competency ?? null,
    };
  }
  async updateSection(): Promise<EvaluationSection> {
    throw new Error("no usado");
  }
  async deleteSection(): Promise<void> {
    throw new Error("no usado");
  }
  async updateQuestion(): Promise<Question> {
    throw new Error("no usado");
  }
  async deleteQuestion(): Promise<void> {
    throw new Error("no usado");
  }
  async updateStatus(): Promise<void> {}
  async updateSettings(
    _i: string,
    _id: string,
    _d: UpdateEvaluationSettingsData,
  ): Promise<Evaluation> {
    throw new Error("no usado");
  }
  async createNewVersion(): Promise<Evaluation> {
    throw new Error("no usado");
  }
}

// ---------- helpers ----------

const valid = (over: Partial<ParsedQuestion> = {}): ParsedQuestion => ({
  sourceNumber: 1,
  text: "¿Cuál es la respuesta?",
  options: [
    { key: "A", text: "a" },
    { key: "B", text: "b" },
    { key: "C", text: "c" },
    { key: "D", text: "d" },
  ],
  correctAnswer: "B",
  competency: null,
  evidence: null,
  contextTitle: null,
  contextText: null,
  image: null,
  warnings: [],
  ...over,
});

const draft = (over: Partial<Evaluation> = {}): Evaluation => ({
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
  durationMinutes: null,
  theme: null,
  ...over,
});

// ---------- validateParsedQuestion ----------

describe("validateParsedQuestion", () => {
  it("acepta una pregunta bien formada", () => {
    expect(validateParsedQuestion(valid())).toBeNull();
  });
  it("rechaza enunciado vacío", () => {
    expect(validateParsedQuestion(valid({ text: "   " }))).toMatch(/enunciado/i);
  });
  it("rechaza menos de 2 opciones", () => {
    expect(validateParsedQuestion(valid({ options: [{ key: "A", text: "a" }] }))).toMatch(/opci/i);
  });
  it("rechaza opciones con texto vacío", () => {
    expect(
      validateParsedQuestion(
        valid({
          options: [
            { key: "A", text: "a" },
            { key: "B", text: "" },
            { key: "C", text: "c" },
            { key: "D", text: "d" },
          ],
        }),
      ),
    ).toMatch(/vacías/i);
  });
  it("rechaza cuando falta la respuesta correcta", () => {
    expect(validateParsedQuestion(valid({ correctAnswer: null }))).toMatch(/correcta/i);
  });
  it("rechaza cuando la correcta no está entre las opciones", () => {
    expect(
      validateParsedQuestion(
        valid({
          options: [
            { key: "A", text: "a" },
            { key: "B", text: "b" },
            { key: "C", text: "c" },
          ],
          correctAnswer: "D",
        }),
      ),
    ).not.toBeNull();
  });
});

describe("partitionParsedQuestions", () => {
  it("separa válidas y problemáticas", () => {
    const { valid: ok, problems } = partitionParsedQuestions([
      valid(),
      valid({ text: "", sourceNumber: 2 }),
      valid({ correctAnswer: null, sourceNumber: 3 }),
    ]);
    expect(ok).toHaveLength(1);
    expect(problems).toHaveLength(2);
  });
});

describe("normalizeOptionKeys", () => {
  it("renumera las claves a A, B, C… preservando el orden", () => {
    const out = normalizeOptionKeys(
      valid({
        options: [
          { key: "B", text: "uno" },
          { key: "C", text: "dos" },
          { key: "D", text: "tres" },
          { key: "E", text: "cuatro" },
        ],
        correctAnswer: "C",
      }),
    );
    expect(out.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
    expect(out.correctAnswer).toBe("B");
  });
  it("devuelve correctAnswer null si la clave original ya no existe", () => {
    const out = normalizeOptionKeys(
      valid({
        options: [
          { key: "A", text: "uno" },
          { key: "B", text: "dos" },
          { key: "C", text: "tres" },
        ],
        // forzado a un valor fuera de rango para probar el caso
        correctAnswer: "D" as never,
      }),
    );
    expect(out.correctAnswer).toBeNull();
  });
});

// ---------- QuestionsFromEvaluation ----------

describe("QuestionsFromEvaluation", () => {
  it("devuelve las preguntas como ParsedQuestion", async () => {
    const detail: EvaluationDetail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          order: 0,
          title: "Lectura",
          content: "Texto del contexto largo…",
          questions: [
            {
              id: "q1",
              number: 1,
              text: "¿Algo?",
              image: null,
              options: [
                { key: "A", text: "a" },
                { key: "B", text: "b" },
                { key: "C", text: "c" },
                { key: "D", text: "d" },
              ],
              correctAnswer: "B",
              justification: null,
              weight: 1,
              soloLevel: null,
              menComponent: null,
              competency: null,
            },
          ],
        } satisfies EvaluationSection,
      ],
    };
    const evals = new FakeEvaluations();
    evals.detail = detail;
    const r = await new QuestionsFromEvaluation(evals).execute({
      actor: teacher,
      evaluationId: "e1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions).toHaveLength(1);
    expect(r.value.questions[0]?.text).toBe("¿Algo?");
    expect(r.value.questions[0]?.correctAnswer).toBe("B");
    expect(r.value.questions[0]?.contextText).toBe("Texto del contexto largo…");
  });

  it("filtra por sección si se indica", async () => {
    const detail: EvaluationDetail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          order: 0,
          title: "A",
          content: "",
          questions: [],
        },
        {
          id: "sec2",
          order: 1,
          title: "B",
          content: "",
          questions: [
            {
              id: "q1",
              number: 1,
              text: "¿?",
              image: null,
              options: [
                { key: "A", text: "a" },
                { key: "B", text: "b" },
                { key: "C", text: "c" },
                { key: "D", text: "d" },
              ],
              correctAnswer: "A",
              justification: null,
              weight: 1,
              soloLevel: null,
              menComponent: null,
              competency: null,
            },
          ],
        } satisfies EvaluationSection,
      ],
    };
    const evals = new FakeEvaluations();
    evals.detail = detail;
    const r = await new QuestionsFromEvaluation(evals).execute({
      actor: teacher,
      evaluationId: "e1",
      sectionId: "sec2",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions).toHaveLength(1);
  });

  it("rechaza si el actor no es TEACHER/COORDINATOR", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new QuestionsFromEvaluation(evals).execute({
      actor: { userId: "x", institutionId: "i1", roles: [] },
      evaluationId: "e1",
    });
    expect(r.ok).toBe(false);
  });
});

// ---------- ImportQuestions ----------

describe("ImportQuestions", () => {
  it("rechaza si no hay preguntas", async () => {
    const r = await new ImportQuestions(new FakeEvaluations(), new FakeBank()).execute({
      actor: teacher,
      questions: [],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(false);
  });

  it("añade a evaluación destino en BORRADOR del autor", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const bank = new FakeBank();
    const r = await new ImportQuestions(evals, bank).execute({
      actor: teacher,
      questions: [valid(), valid({ sourceNumber: 2, text: "¿Otra?", correctAnswer: "A" })],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.imported).toBe(2);
    expect(evals.added).toHaveLength(2);
    expect(evals.added[0]!.correctAnswer).toBe("B");
    expect(evals.added[1]!.correctAnswer).toBe("A");
  });

  it("rechaza importar en evaluación de otro docente", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: otherTeacher,
      questions: [valid()],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza importar en evaluación ya publicada", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft({ status: "PUBLISHED" as EvaluationStatus }), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [valid()],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(false);
  });

  it("guarda en el banco en lote con createMany", async () => {
    const bank = new FakeBank();
    const r = await new ImportQuestions(new FakeEvaluations(), bank).execute({
      actor: teacher,
      questions: [
        valid(),
        valid({ sourceNumber: 2, text: "¿Otra?", correctAnswer: "A", evidence: "ev" }),
      ],
      destination: { kind: "bank", subjectId: "s1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.imported).toBe(2);
    expect(bank.createManyCalls).toHaveLength(1);
    expect(bank.createManyCalls[0]?.[1]?.evidence).toBe("ev");
  });

  it("informe de problemas: las inválidas no se importan", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [valid(), valid({ text: "", sourceNumber: 2 })],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.imported).toBe(1);
    expect(r.value.problems).toHaveLength(1);
  });
});
