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
  /** sectionId → preguntas añadidas (en orden de inserción). */
  addedBySection: Record<string, CreateQuestionData[]> = {};
  addSectionCalls: Array<{ title?: string; content: unknown }> = [];
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
  async addSection(
    _i: string,
    _e: string,
    data: { title?: string; content?: unknown },
  ): Promise<EvaluationSection> {
    const id = `sec-new-${this.addSectionCalls.length + 1}`;
    this.addSectionCalls.push({ title: data.title, content: data.content });
    return {
      id,
      title: data.title ?? null,
      content: data.content ?? { type: "doc", content: [] },
      order: (this.detail?.sections.length ?? 0) + this.addSectionCalls.length,
      questions: [],
    };
  }
  async addQuestion(
    _i: string,
    _e: string,
    sectionId: string,
    data: CreateQuestionData,
  ): Promise<Question> {
    this.added.push(data);
    (this.addedBySection[sectionId] ??= []).push(data);
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
  updateSectionCalls: Array<{ sectionId: string; content: unknown }> = [];
  async updateSection(
    _i: string,
    _e: string,
    sectionId: string,
    data: { title?: string | null; content?: unknown },
  ): Promise<EvaluationSection> {
    if (this.detail?.sections) {
      const idx = this.detail.sections.findIndex((s) => s.id === sectionId);
      if (idx >= 0 && this.detail.sections[idx]) {
        if (data.content !== undefined) {
          this.detail.sections[idx]!.content = data.content;
        }
        if (data.title !== undefined) {
          this.detail.sections[idx]!.title = data.title;
        }
      }
    }
    this.updateSectionCalls.push({ sectionId, content: data.content });
    return {
      id: sectionId,
      title: data.title === undefined ? null : data.title,
      content: data.content,
      order: 1,
      questions: [],
    };
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
  async reorderQuestions(): Promise<void> {
    throw new Error("no usado");
  }
  async duplicateQuestion(): Promise<void> {
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
  async existsByCourseSubjectPeriodYear(): Promise<boolean> {
    return false;
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
  contextImages: {},
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
  bookletTypeId: null,
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

  it("contexto compartido en evaluación → updateSection añade texto e info", async () => {
    const evals = new FakeEvaluations();
    evals.detail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          title: null,
          content: { type: "doc", content: [] },
          order: 1,
          questions: [],
        },
      ],
    };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({ contextText: "El agua es vital para la vida.", correctAnswer: "B" }),
        valid({
          sourceNumber: 2,
          text: "¿Otra?",
          correctAnswer: "B",
          contextText: "El agua es vital para la vida.",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.imported).toBe(2);
    expect(evals.updateSectionCalls).toHaveLength(1);
    const content = evals.updateSectionCalls[0]!.content as {
      type: string;
      content: unknown[];
    };
    expect(content.type).toBe("doc");
    expect(content.content).toHaveLength(1); // un único contexto deduplicado
    expect(evals.added).toHaveLength(2);
    expect(r.value.infos.some((m) => /contexto/i.test(m))).toBe(true);
  });

  it("contexto compartido en banco → embebe «Contexto» al inicio del text", async () => {
    const bank = new FakeBank();
    const r = await new ImportQuestions(new FakeEvaluations(), bank).execute({
      actor: teacher,
      questions: [valid({ contextText: "Texto introductorio", correctAnswer: "B" })],
      destination: { kind: "bank", subjectId: "s1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.infos.some((m) => /Contexto/i.test(m))).toBe(true);
    const data = bank.createManyCalls[0]![0]!;
    const tipTap = data.text as {
      content: { type: string; content?: { text?: string }[] }[];
    };
    expect(tipTap.content[0]!.type).toBe("heading");
    const ctxPara = tipTap.content[1]!;
    expect(ctxPara.type).toBe("paragraph");
    expect(ctxPara.content?.[0]?.text).toBe("Texto introductorio");
  });

  it("contextImages del banco → embebe el nodo `image` en el TipTap", async () => {
    const url = "/api/uploads/evaluations/inst-1/uuid-1.jpg";
    const bank = new FakeBank();
    const r = await new ImportQuestions(new FakeEvaluations(), bank).execute({
      actor: teacher,
      questions: [
        valid({
          contextText: "Observe el gráfico: [IMAGEN p04-fig1] y responda.",
          correctAnswer: "B",
          contextImages: { "p04-fig1": url },
        }),
      ],
      destination: { kind: "bank", subjectId: "s1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = bank.createManyCalls[0]![0]!;
    const tipTap = data.text as {
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    // header (h3 "Contexto") + paragraph ("Observe el gráfico:") + image
    // + paragraph ("y responda.") + paragraph (el `text` de la pregunta)
    expect(tipTap.content).toHaveLength(5);
    expect(tipTap.content[0]!.type).toBe("heading");
    expect(tipTap.content[1]!.type).toBe("paragraph");
    expect(tipTap.content[1]!.content?.[0]?.text).toBe("Observe el gráfico:");
    expect(tipTap.content[2]).toEqual({
      type: "image",
      attrs: { src: url, width: 80 },
    });
    expect(tipTap.content[3]!.type).toBe("paragraph");
    expect(tipTap.content[3]!.content?.[0]?.text).toBe("y responda.");
    expect(tipTap.content[4]!.type).toBe("paragraph");
    expect(tipTap.content[4]!.content?.[0]?.text).toBe("¿Cuál es la respuesta?");
  });

  it("preguntas SIN contexto no producen info ni modifican el section content", async () => {
    const evals = new FakeEvaluations();
    evals.detail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          title: null,
          content: { type: "doc", content: [] },
          order: 1,
          questions: [],
        },
      ],
    };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [valid()],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evals.updateSectionCalls).toHaveLength(0);
    expect(r.value.infos).toEqual([]);
  });

  it("contextImages en formulación (Camino A) → nodo `image` en section.content", async () => {
    const url = "/api/uploads/evaluations/inst-1/uuid-1.jpg";
    const evals = new FakeEvaluations();
    evals.detail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          title: null,
          content: { type: "doc", content: [] },
          order: 1,
          questions: [],
        },
      ],
    };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          contextText: "Observe el gráfico: [IMAGEN p04-fig1] y responda.",
          correctAnswer: "B",
          contextImages: { "p04-fig1": url },
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evals.updateSectionCalls).toHaveLength(1);
    const content = evals.updateSectionCalls[0]!.content as {
      type: string;
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    // paragraph + image + paragraph
    expect(content.content).toHaveLength(3);
    expect(content.content[0]).toMatchObject({ type: "paragraph" });
    expect(content.content[1]).toEqual({
      type: "image",
      attrs: { src: url, width: 80 },
    });
    expect(content.content[2]).toMatchObject({ type: "paragraph" });
  });

  it("Camino A con `contextImages` undefined en una pregunta no rompe (defensa)", async () => {
    // Reproduce el bug de runtime que ocurrió tras desplegar el campo
    // `contextImages`: el payload persistido en BD por builds previos
    // llega a `commitImportAction` sin la key. `aggregateContextImages`
    // debe tolerarlo y seguir como si la pregunta no tuviera figuras.
    const evals = new FakeEvaluations();
    evals.detail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          title: null,
          content: { type: "doc", content: [] },
          order: 1,
          questions: [],
        },
      ],
    };
    const q1 = valid({
      contextText: "Contexto compartido",
      correctAnswer: "B",
    });
    // Simulamos el bug: el campo NO está presente en el JSON.
    const { contextImages: _drop, ...broken } = q1;
    void _drop;
    expect((broken as { contextImages?: unknown }).contextImages).toBeUndefined();

    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [broken as unknown as ParsedQuestion, broken as unknown as ParsedQuestion],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // El contexto se preserva, las imágenes del contexto son {}.
    const content = evals.updateSectionCalls[0]!.content as {
      content: { type: string }[];
    };
    expect(content.content).toHaveLength(1);
    expect(content.content[0]).toMatchObject({ type: "paragraph" });
  });

  // ---------- AUTO-CREAR SECCIONES POR CONTEXTO (sin sectionId) ----------

  it("sin sectionId + con contextos → crea una sección por contexto y reparte preguntas", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          contextText: "El agua es vital para la vida.",
          contextTitle: "Ciencia",
          text: "¿Por qué el agua es vital?",
          correctAnswer: "B",
        }),
        valid({
          sourceNumber: 2,
          text: "¿Cuánta agua se debe beber al día?",
          correctAnswer: "A",
          contextText: "El agua es vital para la vida.",
          contextTitle: "Ciencia",
        }),
        valid({
          sourceNumber: 3,
          text: "¿Cuál es la capital de Francia?",
          correctAnswer: "D",
          contextText: "Europa tiene muchos países.",
          contextTitle: "Geografía",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.imported).toBe(3);
    expect(evals.addSectionCalls).toHaveLength(2);
    // Las preguntas se repartieron entre las dos secciones nuevas
    const sectionIds = Object.keys(evals.addedBySection);
    expect(sectionIds).toHaveLength(2);
    // Las dos preguntas del contexto "Ciencia" caen en una sección,
    // la de "Geografía" en la otra.
    const counts = sectionIds.map((id) => evals.addedBySection[id]!.length).sort();
    expect(counts).toEqual([1, 2]);
    // Cada addSection recibió un content no vacío (el texto del contexto)
    expect(evals.addSectionCalls.every((c) => c.content)).toBe(true);
    expect(r.value.infos.some((m) => /Se crearon 2 secci/i.test(m))).toBe(true);
  });

  it("sin sectionId + sin contextos → rechaza con error claro", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [valid(), valid({ sourceNumber: 2 })],
      destination: { kind: "evaluation", evaluationId: "e1" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDATION");
    expect(r.error.message).toMatch(/contexto destino/i);
    expect(evals.addSectionCalls).toHaveLength(0);
    expect(evals.added).toHaveLength(0);
  });

  it("sin sectionId + algunas preguntas sin contexto → caen a la primera sección creada", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          contextText: "Contexto A.",
          contextTitle: "A",
          text: "Pregunta con contexto A",
          correctAnswer: "A",
        }),
        valid({
          sourceNumber: 2,
          text: "Pregunta suelta sin contexto",
          correctAnswer: "A",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evals.addSectionCalls).toHaveLength(1);
    expect(evals.added).toHaveLength(2);
    // Las dos preguntas van a la única sección creada
    const sectionIds = Object.keys(evals.addedBySection);
    expect(sectionIds).toHaveLength(1);
    expect(evals.addedBySection[sectionIds[0]!]).toHaveLength(2);
    expect(r.value.infos.some((m) => /sin contexto/i.test(m))).toBe(true);
  });

  it("contexto con [TABLA: ...] → la sección auto-creada recibe un nodo table real, no el string literal", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const tableContext = `Lea las descripciones de la columna izquierda.
[TABLA: In the kitchen - Descripciones y Palabras | Descripciones | Palabras |
|---------------|----------|
| 1. These are round. | A. bowls |
| 2. Hot drink. | B. cake |]`;
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          contextText: tableContext,
          contextTitle: "In the kitchen",
          text: "¿Cuál concuerda?",
          correctAnswer: "A",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evals.addSectionCalls).toHaveLength(1);
    const content = evals.addSectionCalls[0]!.content as {
      type: string;
      content: { type: string; content?: unknown }[];
    };
    // El section content NO debe contener el string literal [TABLA:...
    const flat = JSON.stringify(content);
    expect(flat).not.toContain("[TABLA:");
    // Debe contener un nodo `table` con la cabecera "Descripciones"
    expect(content.type).toBe("doc");
    const tableNode = content.content.find((n) => n.type === "table");
    expect(tableNode).toBeDefined();
    // El heading(4) con el título del bloque va antes de la tabla
    const headingNode = content.content.find(
      (n) => n.type === "heading" && (n as { attrs?: { level?: number } }).attrs?.level === 4,
    ) as { content: { text: string }[] } | undefined;
    expect(headingNode).toBeDefined();
    expect(headingNode!.content[0]!.text).toBe("In the kitchen - Descripciones y Palabras");
  });

  // ---------- LATEX: $...$ / $$...$$ → nodos inlineMath / blockMath ----------

  it("pregunta con $inline$ → nodo inlineMath dentro del paragraph del enunciado", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [valid({ text: "La energía $E=mc^2$ es famosa", correctAnswer: "B" })],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = evals.added[0]!;
    const tipTap = data.text as {
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    expect(tipTap.content).toHaveLength(1);
    expect(tipTap.content[0]!.type).toBe("paragraph");
    expect(tipTap.content[0]!.content).toEqual([
      { type: "text", text: "La energía " },
      { type: "inlineMath", attrs: { tex: "E=mc^2" } },
      { type: "text", text: " es famosa" },
    ]);
  });

  it("pregunta con $$block$$ al inicio → blockMath top-level + paragraph con el resto", async () => {
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          text: "$$x^2 + y^2 = z^2$$ Es el teorema de Pitágoras.",
          correctAnswer: "A",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = evals.added[0]!;
    const tipTap = data.text as {
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    // blockMath top-level ($$...$$ toma todo el contenido) + paragraph con el resto
    expect(tipTap.content).toHaveLength(2);
    expect(tipTap.content[0]).toEqual({
      type: "blockMath",
      attrs: { tex: "x^2 + y^2 = z^2" },
    });
    expect(tipTap.content[1]!.type).toBe("paragraph");
    expect(tipTap.content[1]!.content?.[0]?.text).toBe(" Es el teorema de Pitágoras.");
  });

  it("contexto compartido con $inline$ → nodo inlineMath dentro del section.content (Camino A)", async () => {
    const evals = new FakeEvaluations();
    evals.detail = {
      ...draft(),
      sections: [
        {
          id: "sec1",
          title: null,
          content: { type: "doc", content: [] },
          order: 1,
          questions: [],
        },
      ],
    };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          contextText: "Aplica la fórmula $\\Delta = b^2 - 4ac$ al caso.",
          correctAnswer: "B",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(evals.updateSectionCalls).toHaveLength(1);
    const content = evals.updateSectionCalls[0]!.content as {
      type: string;
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    expect(content.content).toHaveLength(1);
    expect(content.content[0]!.type).toBe("paragraph");
    expect(content.content[0]!.content).toEqual([
      { type: "text", text: "Aplica la fórmula " },
      { type: "inlineMath", attrs: { tex: "\\Delta = b^2 - 4ac" } },
      { type: "text", text: " al caso." },
    ]);
  });

  it("banco con pregunta que trae $inline$ → el nodo inlineMath llega al doc TipTap persistido", async () => {
    const bank = new FakeBank();
    const r = await new ImportQuestions(new FakeEvaluations(), bank).execute({
      actor: teacher,
      questions: [valid({ text: "Si $x$ y $y$ son positivos…", correctAnswer: "A" })],
      destination: { kind: "bank", subjectId: "s1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = bank.createManyCalls[0]![0]!;
    const tipTap = data.text as {
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    expect(tipTap.content).toHaveLength(1);
    expect(tipTap.content[0]!.type).toBe("paragraph");
    expect(tipTap.content[0]!.content).toEqual([
      { type: "text", text: "Si " },
      { type: "inlineMath", attrs: { tex: "x" } },
      { type: "text", text: " y " },
      { type: "inlineMath", attrs: { tex: "y" } },
      { type: "text", text: " son positivos…" },
    ]);
  });

  // ---------- HEURÍSTICA POST-PARSE: pseudo-notación [expr]^N ----------

  it("pregunta con corchetes literales + ^N (sin delimitadores LaTeX) → heurística produce inlineMath", async () => {
    // Caso real que motivó el heurístico (PR #18): la IA emite el
    // enunciado como texto plano y la profesora quiere ver la fórmula
    // renderizada. El helper de import debe detectar el patrón
    // `[expr]^N` y emitir un inlineMath con la versión LaTeX correcta.
    const evals = new FakeEvaluations();
    evals.detail = { ...draft(), sections: [] };
    const r = await new ImportQuestions(evals, new FakeBank()).execute({
      actor: teacher,
      questions: [
        valid({
          text: "El resultado de la expresión [10 + 6 - 4(8/2)]^0 + 5, es:",
          correctAnswer: "B",
        }),
      ],
      destination: { kind: "evaluation", evaluationId: "e1", sectionId: "sec1" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = evals.added[0]!;
    const tipTap = data.text as {
      content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string }[] }[];
    };
    expect(tipTap.content).toHaveLength(1);
    expect(tipTap.content[0]!.type).toBe("paragraph");
    expect(tipTap.content[0]!.content).toEqual([
      { type: "text", text: "El resultado de la expresión " },
      { type: "inlineMath", attrs: { tex: "[10 + 6 - 4(8/2)]^{0}" } },
      { type: "text", text: " + 5, es:" },
    ]);
  });
});
