import { beforeEach, describe, expect, it } from "vitest";
import { ChangeEvaluationStatus } from "@/modules/evaluations/application/change-status";
import {
  AddQuestion,
  CreateEvaluation,
  DeleteQuestion,
  DeleteSection,
  UpdateQuestion,
  UpdateSection,
} from "@/modules/evaluations/application/manage-evaluations";
import {
  validateQuestionContent,
  validateQuestionShape,
} from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
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
  UpdateEvaluationSettingsData,
} from "@/modules/evaluations/domain/evaluation";
import type {
  Course,
  CourseRepository,
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
  Period,
  PeriodRepository,
} from "@/modules/academic/domain/types";
import type { BookletTypeRepository } from "@/modules/booklet-types/domain/booklet-type";
import type {
  NotificationMessage,
  NotificationSender,
} from "@/modules/notifications/domain/notification";
import type {
  LeaderAssignment,
  LeaderAssignmentRepository,
} from "@/modules/leader-assignments/domain/leader-assignment";

class FakeEvaluations implements EvaluationRepository {
  items: Evaluation[] = [];
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
      // Espejo del Prisma repo: al crear, el default de maquetación es 2
      // columnas (estilo ICFES). Ver prisma-evaluation-repository.ts.
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
  async findByCourseIds(_i: string, courseIds: string[]): Promise<EvaluationListItem[]> {
    if (courseIds.length === 0) return [];
    return [];
  }

  async findByInstitution(): Promise<EvaluationListItem[]> {
    return [];
  }
  async addSection(): Promise<EvaluationSection> {
    throw new Error("no usado");
  }
  /** Registro de llamadas, para comprobar que el use case delega. */
  updated: Array<{ kind: "section" | "question"; id: string }> = [];
  deleted: Array<{ kind: "section" | "question"; id: string }> = [];
  /** Mapa pregunta → sección dueña. Usado por el fake para simular la
   *  cascada de "sección vacía → borrarla también". Sembrar con `seed`. */
  questionSections: Map<string, string> = new Map();
  /** Sembrador para que los tests pueblen la sección dueña de cada pregunta. */
  seed(questionId: string, sectionId: string): void {
    this.questionSections.set(questionId, sectionId);
  }
  async updateSection(_i: string, _e: string, sectionId: string): Promise<EvaluationSection> {
    this.updated.push({ kind: "section", id: sectionId });
    return { id: sectionId, title: null, content: null, order: 0, questions: [] };
  }
  async deleteSection(_i: string, _e: string, sectionId: string): Promise<void> {
    this.deleted.push({ kind: "section", id: sectionId });
    // Borra también las preguntas que vivían en esa sección para que
    // `countQuestionsInSection` quede coherente con el "después" del delete.
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
    // Quita del mapa para que `countQuestionsInSection` refleje el post-delete.
    this.questionSections.delete(questionId);
  }
  async countQuestionsInSection(sectionId: string): Promise<number> {
    let n = 0;
    for (const sid of this.questionSections.values()) if (sid === sectionId) n++;
    return n;
  }
  async reorderQuestions(): Promise<void> {
    // No-op en este fake: el flujo que ejercita reorderQuestions se cubre
    // directamente contra `PrismaEvaluationRepository` en e2e. Aquí solo
    // necesitamos satisfacer la interfaz.
  }
  async duplicateQuestion(): Promise<void> {
    // No-op en este fake: el flujo que ejercita duplicateQuestion se cubre
    // directamente contra `PrismaEvaluationRepository` en e2e. Aquí solo
    // necesitamos satisfacer la interfaz.
  }
  async addQuestion(institutionId: string, evaluationId: string): Promise<Question> {
    const e = this.items.find((x) => x.id === evaluationId)!;
    e.totalQuestions += 1;
    return {
      id: `q-${e.totalQuestions}`,
      number: e.totalQuestions,
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
  async updateStatus(institutionId: string, id: string, status: EvaluationStatus) {
    const e = this.items.find((x) => x.id === id);
    if (e) e.status = status;
  }
  async updateSettings(
    _i: string,
    id: string,
    data: UpdateEvaluationSettingsData,
  ): Promise<Evaluation> {
    const e = this.items.find((x) => x.id === id);
    if (!e) throw new Error(`Evaluation ${id} no encontrada`);
    e.durationMinutes = data.durationMinutes;
    return e;
  }
  async createNewVersion(): Promise<Evaluation> {
    throw new Error("no usado");
  }
  /**
   * Scope check del líder ECU: por defecto la evaluación cae en `c1`
   * (mismo curso al que `FakeLeaderAssignments` declara asignado al
   * coordinador). Tests específicos de scope viven en
   * `change-status-scope.test.ts`.
   */
  evaluationCourseId: string | null = "c1";
  async findCourseIdByEvaluation(_i: string, _eid: string): Promise<string | null> {
    return this.evaluationCourseId;
  }
  async existsByCourseSubjectPeriodBookletTypeYear(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
    bookletTypeId: string | null,
    academicYearId: string,
  ): Promise<boolean> {
    return this.items.some(
      (e) =>
        e.institutionId === institutionId &&
        e.courseSubjectId === courseSubjectId &&
        e.periodId === periodId &&
        e.bookletTypeId === bookletTypeId &&
        e.academicYearId === academicYearId,
    );
  }
}

class FakeCourseSubjects implements CourseSubjectRepository {
  constructor(private readonly items: CourseSubject[]) {}
  async findAll(): Promise<CourseSubjectView[]> {
    return [];
  }
  async findById(_i: string, id: string) {
    return this.items.find((c) => c.id === id) ?? null;
  }
  async exists() {
    return false;
  }
  async create(): Promise<CourseSubject> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    // no usado en los tests que pasan esta fake
  }
}

const noPeriods: PeriodRepository = {
  async findAll(): Promise<Period[]> {
    return [];
  },
  async findById() {
    return null;
  },
  async create(): Promise<Period> {
    throw new Error("no usado");
  },
  async update() {
    return null;
  },
  async delete() {
    // no-op
  },
  async setCurrent() {
    // no-op — los tests de CreateEvaluation no ejercitan el flip
  },
};

/** Repo de BookletTypes en memoria para los tests de CreateEvaluation.
 *  Solo los tests que cubren validación de bookletTypeId lo enriquecen. */
const noBookletTypes: BookletTypeRepository = {
  async findById() {
    return null;
  },
  async listByPeriod() {
    return [];
  },
  async listByInstitution() {
    return [];
  },
  async create() {
    throw new Error("no usado");
  },
  async update() {
    return null;
  },
  async delete() {
    // no-op
  },
};

/** Repo de cursos en memoria. Single curso (`c1`) en `ay1` por defecto; los
 *  tests que necesitan un segundo año académico inyectan `c2`/`ay2`. */
class FakeCourses implements CourseRepository {
  constructor(private readonly items: Course[]) {}
  async findAll(): Promise<Course[]> {
    return [...this.items];
  }
  async findById(_i: string, id: string): Promise<Course | null> {
    return this.items.find((c) => c.id === id) ?? null;
  }
  async create(): Promise<Course> {
    throw new Error("no usado");
  }
}

/** Helper: curso por defecto `c1` en `ay1`. */
const fakeCourses = (extra: Course[] = []): CourseRepository =>
  new FakeCourses([
    { id: "c1", institutionId: "i1", academicYearId: "ay1", name: "11°", code: "G11" },
    ...extra,
  ]);

class SpySender implements NotificationSender {
  sent: NotificationMessage[] = [];
  async send(m: NotificationMessage) {
    this.sent.push(m);
  }
}

/**
 * Stub mínimo de LeaderAssignmentRepository para los tests de flujo.
 * Por defecto el coordinador está asignado a `c1` — coincide con el
 * `evaluationCourseId` que devuelve `FakeEvaluations.findCourseIdByEvaluation`,
 * así que el scope check pasa sin tocar nada. Tests específicos de scope
 * (ForbiddenError en transiciones out-of-scope) viven en
 * `change-status-scope.test.ts`.
 */
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

/**
 * Stub mínimo de EvaluationRuleRepository para ChangeEvaluationStatus.
 * Sprint ago 2026: los tests de flujo de aprobación existentes no
 * configuran reglas — por defecto findForEvaluation devuelve null (modo
 * libre). Tests específicos de enforcement se cubren en
 * tests/unit/evaluation-rules-enforcement.test.ts (commit 5).
 */
class FakeEvaluationRules {
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
    throw new Error("no usado");
  }
  async update() {
    return null;
  }
  async delete(): Promise<void> {
    /* noop */
  }
  async findForEvaluation() {
    return null;
  }
}

const teacher: AuthenticatedUser = { userId: "t1", institutionId: "i1", roles: ["TEACHER"] };
const coordinator: AuthenticatedUser = {
  userId: "c1",
  institutionId: "i1",
  roles: ["ECU_LIDER"],
};

const question = (over: Partial<CreateQuestionData> = {}): CreateQuestionData => ({
  text: "¿2+2?",
  options: (["A", "B", "C", "D"] as const).map((key) => ({ key, text: key })),
  correctAnswer: "B",
  ...over,
});

describe("validateQuestionShape", () => {
  it("acepta 4 opciones A-D con correcta válida", () => {
    expect(validateQuestionShape(question())).toBeNull();
  });
  it("acepta 2 opciones (verdadero/falso) con correcta válida", () => {
    const q = question({
      options: [
        { key: "A", text: "a" },
        { key: "B", text: "b" },
      ],
      correctAnswer: "A",
    });
    expect(validateQuestionShape(q)).toBeNull();
  });
  it("acepta 3 opciones (tricotomía) con correcta válida", () => {
    const q = question({
      options: [
        { key: "A", text: "a" },
        { key: "B", text: "b" },
        { key: "C", text: "c" },
      ],
      correctAnswer: "C",
    });
    expect(validateQuestionShape(q)).toBeNull();
  });
  it("acepta 5 opciones", () => {
    const q = question({
      options: (
        [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
          { key: "C", text: "c" },
          { key: "D", text: "d" },
          { key: "E", text: "e" },
        ] as const
      ).map((o) => ({ key: o.key, text: o.text })),
      correctAnswer: "E",
    });
    expect(validateQuestionShape(q)).toBeNull();
  });
  it("acepta 8 opciones (máximo, todas las letras A–H)", () => {
    const q = question({
      options: (
        [
          { key: "A", text: "a" },
          { key: "B", text: "b" },
          { key: "C", text: "c" },
          { key: "D", text: "d" },
          { key: "E", text: "e" },
          { key: "F", text: "f" },
          { key: "G", text: "g" },
          { key: "H", text: "h" },
        ] as const
      ).map((o) => ({ key: o.key, text: o.text })),
      correctAnswer: "H",
    });
    expect(validateQuestionShape(q)).toBeNull();
  });
  it("rechaza 1 opción (muy pocas)", () => {
    expect(validateQuestionShape(question({ options: [{ key: "A", text: "a" }] }))).not.toBeNull();
  });
  it("rechaza 9 opciones (excede A–H)", () => {
    // Cast: probando rechazo de una forma no representable en AnswerKey.
    const badOptions = [
      { key: "A", text: "a" },
      { key: "B", text: "b" },
      { key: "C", text: "c" },
      { key: "D", text: "d" },
      { key: "E", text: "e" },
      { key: "F", text: "f" },
      { key: "G", text: "g" },
      { key: "H", text: "h" },
      { key: "I" as const, text: "i" },
    ] as unknown as { key: import("@/modules/evaluations/domain/evaluation").AnswerKey }[];
    expect(validateQuestionShape({ ...question(), options: badOptions })).not.toBeNull();
  });
  it("rechaza correcta que no está entre las opciones declaradas", () => {
    const bad = question({
      options: [
        { key: "A", text: "a" },
        { key: "B", text: "b" },
      ],
      correctAnswer: "C",
    });
    expect(validateQuestionShape(bad)).not.toBeNull();
  });

  // ===== Nuevas validaciones (Fase 12 — enunciado y opciones obligatorias) =====
  it("rechaza enunciado vacío (string)", () => {
    expect(validateQuestionContent(question({ text: "" }))).not.toBeNull();
  });
  it("rechaza enunciado con solo espacios", () => {
    expect(validateQuestionContent(question({ text: "   " }))).not.toBeNull();
  });
  it("rechaza enunciado TipTap con párrafo vacío", () => {
    const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
    expect(
      validateQuestionContent(question({ text: emptyDoc as unknown as string })),
    ).not.toBeNull();
  });
  it("rechaza opción con texto vacío", () => {
    const bad = question({
      options: [
        { key: "A", text: "" },
        { key: "B", text: "b" },
        { key: "C", text: "c" },
        { key: "D", text: "d" },
      ],
      correctAnswer: "A",
    });
    expect(validateQuestionContent(bad)).not.toBeNull();
  });
  it("rechaza opción TipTap con solo espacios", () => {
    const bad = question({
      options: [
        { key: "A", text: "a" },
        { key: "B", text: { type: "doc", content: [{ type: "paragraph" }] } },
        { key: "C", text: "c" },
        { key: "D", text: "d" },
      ] as unknown as CreateQuestionData["options"],
      correctAnswer: "A",
    });
    expect(validateQuestionContent(bad)).not.toBeNull();
  });
  it("acepta enunciado y opciones no vacíos", () => {
    expect(validateQuestionContent(question())).toBeNull();
  });
  // Regresión ago 2026: si `rich()` en actions.ts convierte el valor de
  // un `<Input>` plano a primitivo (number/boolean/null) antes de llegar
  // aquí, la validación falla aunque el docente haya tipeado contenido.
  // Contrato: cuando el docente tipea "1" en una opción plana, el valor
  // que llega al use case debe ser la STRING "1", no el NUMBER 1.
  // richTextToPlain solo extrae texto de strings/objetos; primitives
  // (number, boolean, null) devuelven "" → falla la validación.
  it("acepta opciones con texto numérico como string (regresión rich()+JSON.parse)", () => {
    const good = question({
      text: "¿Cuánto es 2+2?",
      options: [
        { key: "A", text: "1" }, // string "1" (lo que produce el <Input> plano)
        { key: "B", text: "2" },
        { key: "C", text: "3" },
        { key: "D", text: "4" },
      ],
    });
    expect(validateQuestionContent(good)).toBeNull();
  });
  it("rechaza opciones con texto numérico como primitivo (bug surface)", () => {
    // Esto es lo que ANTES del fix se le escapaba al use case cuando el
    // docente tipeaba "1" en un <Input> plano: rich() convertía "1" a 1
    // vía JSON.parse. Mantenemos el test para que cualquier cambio que
    // reintroduzca el primitivo en la frontera sea visible.
    const bad = question({
      text: "¿Cuánto es 2+2?",
      options: [
        { key: "A", text: 1 as unknown as string }, // primitivo number (lo que NO debe llegar)
        { key: "B", text: "2" },
        { key: "C", text: "3" },
        { key: "D", text: "4" },
      ],
    });
    expect(validateQuestionContent(bad)).not.toBeNull();
  });
  it("rechaza opciones con texto boolean/null como primitivo (mismo bug surface)", () => {
    const badTrue = question({
      options: [
        { key: "A", text: true as unknown as string }, // primitivo boolean
        { key: "B", text: "b" },
        { key: "C", text: "c" },
        { key: "D", text: "d" },
      ],
    });
    expect(validateQuestionContent(badTrue)).not.toBeNull();
    const badNull = question({
      options: [
        { key: "A", text: null as unknown as string },
        { key: "B", text: "b" },
        { key: "C", text: "c" },
        { key: "D", text: "d" },
      ],
    });
    expect(validateQuestionContent(badNull)).not.toBeNull();
  });
});

describe("CreateEvaluation", () => {
  it("crea BORRADOR cuando la asignatura-curso existe", async () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new CreateEvaluation(repo, cs, noPeriods, fakeCourses(), noBookletTypes);
    const r = await uc.execute({ actor: teacher, data: { title: "P1", courseSubjectId: "cs1" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("DRAFT");
  });
  it("rechaza asignatura-curso inexistente", async () => {
    const uc = new CreateEvaluation(
      new FakeEvaluations(),
      new FakeCourseSubjects([]),
      noPeriods,
      fakeCourses(),
      noBookletTypes,
    );
    const r = await uc.execute({ actor: teacher, data: { title: "P1", courseSubjectId: "nope" } });
    expect(r.ok).toBe(false);
  });

  // Sprint 7: duración estimada al crear (captura temprana para que el
  // docente no se salte el dato en la portada del compendio).
  it("persiste durationMinutes cuando se envía al crear", async () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new CreateEvaluation(repo, cs, noPeriods, fakeCourses(), noBookletTypes);
    const r = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", durationMinutes: 90 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.durationMinutes).toBe(90);
      const stored = await repo.findById("i1", r.value.id);
      expect(stored?.durationMinutes).toBe(90);
    }
  });
  it("omite durationMinutes cuando no se envía (queda null → heurístico)", async () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new CreateEvaluation(repo, cs, noPeriods, fakeCourses(), noBookletTypes);
    const r = await uc.execute({ actor: teacher, data: { title: "P1", courseSubjectId: "cs1" } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.durationMinutes).toBeNull();
  });
  it("acepta durationMinutes explícitamente null al crear", async () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new CreateEvaluation(repo, cs, noPeriods, fakeCourses(), noBookletTypes);
    const r = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", durationMinutes: null },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.durationMinutes).toBeNull();
  });
  it("rechaza durationMinutes fuera de rango al crear (VALIDATION)", async () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new CreateEvaluation(repo, cs, noPeriods, fakeCourses(), noBookletTypes);
    const r = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", durationMinutes: 0 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
  it("rechaza durationMinutes no-entero al crear", async () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const uc = new CreateEvaluation(repo, cs, noPeriods, fakeCourses(), noBookletTypes);
    const r = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", durationMinutes: 45.5 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });
});

/**
 * Regla de unicidad de formulaciones (mismo asignatura-curso + periodo +
 * tipo de cuadernillo + año): el `CreateEvaluation` debe rechazar el duplicado
 * y dejar pasar variaciones legítimas (distinto periodo, distinto asignatura-
 * curso, distinto año académico, distinto bookletType, o formulación previa
 * eliminada lógicamente).
 */
describe("CreateEvaluation — unicidad (asignatura-curso + periodo + tipo de cuadernillo + año)", () => {
  const makeUc = () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([
      { id: "cs1", courseId: "c1", subjectId: "s1" },
      { id: "cs2", courseId: "c1", subjectId: "s2" },
    ]);
    const periods: PeriodRepository = {
      ...noPeriods,
      async findById(_i, id) {
        if (id === "p1" || id === "p2")
          return { id, institutionId: "i1", academicYearId: "ay1" } as Period;
        return null;
      },
    };
    const uc = new CreateEvaluation(repo, cs, periods, fakeCourses(), noBookletTypes);
    return { repo, uc };
  };

  it("bloquea crear dos formulaciones con misma (cs1, p1, ay1) y bookletType null", async () => {
    const { uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("VALIDATION");
      expect(second.error.message).toMatch(/asignatura-grado, periodo, tipo de cuadernillo y año/i);
    }
  });

  it("permite crear en el mismo asignatura-curso pero con otro periodo", async () => {
    const { uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p2" },
    });
    expect(second.ok).toBe(true);
  });

  it("permite crear en el mismo curso y periodo pero con otra asignatura-curso", async () => {
    const { uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs2", periodId: "p1" },
    });
    expect(second.ok).toBe(true);
  });

  it("permite duplicar la combinación si la formulación previa está en otro año académico", async () => {
    // Dos cursos distintos (`c1` en `ay1`, `c2` en `ay2`) que comparten la
    // misma asignatura-cursoId `cs1` NO deberían chocar (cada uno vive en su
    // año). Usamos un solo courseSubject y variamos el `courseId` (que es
    // de donde se deriva el año académico).
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([
      // Mismo `id` `cs1` reusado en dos cursos de distintos años: el modelo
      // real asocia courseSubject a course 1-a-1, pero aquí nos basta con
      // simular el cambio de año via `courseId` en la respuesta del repo.
      { id: "cs1", courseId: "c1", subjectId: "s1" },
    ]);
    let toggle = 0;
    const coursesRepo: CourseRepository = {
      async findAll() {
        return [];
      },
      async findById() {
        toggle++;
        return toggle === 1
          ? { id: "c1", institutionId: "i1", academicYearId: "ay1", name: "11°", code: "G11" }
          : { id: "c1", institutionId: "i1", academicYearId: "ay2", name: "11°", code: "G11" };
      },
      async create() {
        throw new Error("no usado");
      },
    };
    const periods: PeriodRepository = {
      ...noPeriods,
      async findById(_i, id) {
        return { id, institutionId: "i1", academicYearId: "ayX" } as Period;
      },
    };
    const uc = new CreateEvaluation(repo, cs, periods, coursesRepo, noBookletTypes);
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(second.ok).toBe(true);
  });

  it("permite duplicar si la formulación previa fue eliminada lógicamente (deletedAt)", async () => {
    const { repo, uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      // Simulamos soft-delete a mano (el repo Prisma lo gestiona; aquí
      // basta con que la fila no esté en `items` para el chequeo).
      repo.items = repo.items.filter((e) => e.id !== first.value.id);
    }
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(second.ok).toBe(true);
  });

  it("bloquea duplicado con periodId null si ya existe otro sin periodo", async () => {
    const { uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1" },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("VALIDATION");
      expect(second.error.message).toMatch(/sin periodo/i);
    }
  });

  it("permite (cs1, sin periodo) coexistir con (cs1, p1)", async () => {
    const { uc } = makeUc();
    const sinPeriodo = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1" },
    });
    expect(sinPeriodo.ok).toBe(true);
    const conPeriodo = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(conPeriodo.ok).toBe(true);
  });
});

/**
 * Permutaciones con bookletTypeId no nulo (ago 2026). El describe anterior
 * cubre el caso null/null — los tests de acá confirman que dos formulaciones
 * con misma (cs, p, ay) pero distinto bookletTypeId PUEDEN coexistir, y que
 * (cs, p, btX, ay) bloquea crear otro (cs, p, btX, ay).
 *
 * El setup inyecta un BookletTypeRepository mock con dos tipos (btX, btY)
 * en `p1`. FakeEvaluations ya persiste `bookletTypeId` (commit 1 de este
 * PR), así que la regla de unicidad opera sobre la clave completa.
 */
describe("CreateEvaluation — unicidad con bookletTypeId", () => {
  const twoBookletTypes: BookletTypeRepository = {
    async findById(_i, id) {
      if (id === "btX") {
        return {
          id: "btX",
          institutionId: "i1",
          periodId: "p1",
          name: "Estándar",
          description: null,
          order: 0,
        };
      }
      if (id === "btY") {
        return {
          id: "btY",
          institutionId: "i1",
          periodId: "p1",
          name: "Especial",
          description: null,
          order: 1,
        };
      }
      return null;
    },
    async listByPeriod() {
      return [];
    },
    async listByInstitution() {
      return [];
    },
    async create() {
      throw new Error("no usado");
    },
    async update() {
      return null;
    },
    async delete() {
      // no-op
    },
  };

  const makeUc = () => {
    const repo = new FakeEvaluations();
    const cs = new FakeCourseSubjects([{ id: "cs1", courseId: "c1", subjectId: "s1" }]);
    const periods: PeriodRepository = {
      ...noPeriods,
      async findById(_i, id) {
        return { id, institutionId: "i1", academicYearId: "ay1" } as Period;
      },
    };
    const uc = new CreateEvaluation(repo, cs, periods, fakeCourses(), twoBookletTypes);
    return { repo, uc };
  };

  it("permite (cs1, p1, btX, ay1) coexistir con (cs1, p1, btY, ay1)", async () => {
    const { uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1", bookletTypeId: "btX" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1", bookletTypeId: "btY" },
    });
    expect(second.ok).toBe(true);
  });

  it("permite (cs1, p1, btX, ay1) coexistir con (cs1, p1, null, ay1) (sin tipo)", async () => {
    const { uc } = makeUc();
    const conTipo = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1", bookletTypeId: "btX" },
    });
    expect(conTipo.ok).toBe(true);
    // bookletTypeId omitido → cae al slot "null" en la clave de unicidad.
    const sinTipo = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1" },
    });
    expect(sinTipo.ok).toBe(true);
  });

  it("bloquea crear dos formulaciones con misma (cs1, p1, btX, ay1)", async () => {
    const { uc } = makeUc();
    const first = await uc.execute({
      actor: teacher,
      data: { title: "P1", courseSubjectId: "cs1", periodId: "p1", bookletTypeId: "btX" },
    });
    expect(first.ok).toBe(true);
    const second = await uc.execute({
      actor: teacher,
      data: { title: "P2", courseSubjectId: "cs1", periodId: "p1", bookletTypeId: "btX" },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("VALIDATION");
      expect(second.error.message).toMatch(/asignatura-grado, periodo, tipo de cuadernillo y año/i);
    }
  });
});

describe("Flujo de aprobación", () => {
  let repo: FakeEvaluations;
  let sender: SpySender;
  let workflow: ChangeEvaluationStatus;
  let evalId: string;

  beforeEach(async () => {
    repo = new FakeEvaluations();
    sender = new SpySender();
    workflow = new ChangeEvaluationStatus(
      repo,
      sender,
      {
        coordinatorIds: async () => ["c1"],
      },
      new FakeEvaluationRules(),
      new FakeLeaderAssignments(),
    );
    const created = await repo.create("i1", "t1", { title: "P", courseSubjectId: "cs1" });
    evalId = created.id;
    // Necesita una pregunta para ser realista, pero el flujo no lo exige aquí.
    await new AddQuestion(repo, new FakeEvaluationRules()).execute({
      actor: teacher,
      evaluationId: evalId,
      sectionId: "sec1",
      data: question(),
    });
  });

  it("enviar a revisión notifica a los coordinadores", async () => {
    const r = await workflow.execute({ actor: teacher, evaluationId: evalId, to: "IN_REVIEW" });
    expect(r.ok).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.type).toBe("EVALUATION_PENDING_REVIEW");
    expect(sender.sent[0]!.userId).toBe("c1");
  });

  it("rechazo exige comentario y notifica al docente", async () => {
    await workflow.execute({ actor: teacher, evaluationId: evalId, to: "IN_REVIEW" });
    const noComment = await workflow.execute({
      actor: coordinator,
      evaluationId: evalId,
      to: "DRAFT",
    });
    expect(noComment.ok).toBe(false);
    const rejected = await workflow.execute({
      actor: coordinator,
      evaluationId: evalId,
      to: "DRAFT",
      comment: "Corrige la pregunta 1",
    });
    expect(rejected.ok).toBe(true);
    expect(sender.sent.some((m) => m.type === "EVALUATION_REJECTED")).toBe(true);
  });

  it("un docente no puede aprobar", async () => {
    await workflow.execute({ actor: teacher, evaluationId: evalId, to: "IN_REVIEW" });
    const r = await workflow.execute({ actor: teacher, evaluationId: evalId, to: "APPROVED" });
    expect(r.ok).toBe(false);
  });

  it("ruta completa: revisión → aprobar → publicar", async () => {
    await workflow.execute({ actor: teacher, evaluationId: evalId, to: "IN_REVIEW" });
    const approved = await workflow.execute({
      actor: coordinator,
      evaluationId: evalId,
      to: "APPROVED",
    });
    expect(approved.ok).toBe(true);
    const published = await workflow.execute({
      actor: coordinator,
      evaluationId: evalId,
      to: "PUBLISHED",
    });
    expect(published.ok).toBe(true);
    if (published.ok) expect(published.value.status).toBe("PUBLISHED");
  });
});

/**
 * Edición y borrado de contextos y preguntas.
 *
 * La renumeración al borrar vive en `computeRenumbering` (dominio) y se prueba
 * aparte en renumbering.test.ts. Aquí se cubren las reglas del use case:
 * autorización, DRAFT-only, y que opciones y respuesta correcta viajen juntas.
 */
describe("Edición de contextos y preguntas", () => {
  let repo: FakeEvaluations;
  let evalId: string;

  beforeEach(async () => {
    repo = new FakeEvaluations();
    const created = await repo.create("i1", teacher.userId, {
      title: "T",
      courseSubjectId: "cs1",
    });
    evalId = created.id;
  });

  describe("UpdateSection", () => {
    it("el autor edita su contexto en BORRADOR", async () => {
      const r = await new UpdateSection(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        sectionId: "s1",
        data: { title: "Nuevo título" },
      });
      expect(r.ok).toBe(true);
      expect(repo.updated).toEqual([{ kind: "section", id: "s1" }]);
    });

    it("otro docente NO puede editar la evaluación ajena", async () => {
      const otro: AuthenticatedUser = { userId: "t2", institutionId: "i1", roles: ["TEACHER"] };
      const r = await new UpdateSection(repo).execute({
        actor: otro,
        evaluationId: evalId,
        sectionId: "s1",
        data: { title: "Hackeado" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
      expect(repo.updated).toEqual([]);
    });

    it("no se puede editar fuera de BORRADOR", async () => {
      await repo.updateStatus("i1", evalId, "APPROVED");
      const r = await new UpdateSection(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        sectionId: "s1",
        data: { title: "Tarde" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/BORRADOR/i);
    });
  });

  describe("DeleteSection", () => {
    it("el autor borra su contexto y delega en el repositorio", async () => {
      const r = await new DeleteSection(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        sectionId: "s1",
      });
      expect(r.ok).toBe(true);
      expect(repo.deleted).toEqual([{ kind: "section", id: "s1" }]);
    });

    it("no borra si la evaluación ya no está en BORRADOR", async () => {
      await repo.updateStatus("i1", evalId, "PUBLISHED");
      const r = await new DeleteSection(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        sectionId: "s1",
      });
      expect(r.ok).toBe(false);
      expect(repo.deleted).toEqual([]);
    });
  });

  describe("UpdateQuestion", () => {
    const opciones = (["A", "B", "C", "D"] as const).map((key) => ({ key, text: key }));

    it("edita solo el enunciado sin tocar opciones", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
        data: { text: "Enunciado corregido" },
      });
      expect(r.ok).toBe(true);
      expect(repo.updated).toEqual([{ kind: "question", id: "q1" }]);
    });

    it("edita opciones y correcta juntas", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
        data: { options: opciones, correctAnswer: "C" },
      });
      expect(r.ok).toBe(true);
    });

    it("rechaza cambiar la correcta sin enviar las opciones", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
        data: { correctAnswer: "C" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/ambas/i);
      expect(repo.updated).toEqual([]);
    });

    it("rechaza cambiar las opciones sin enviar la correcta", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
        data: { options: opciones },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/ambas/i);
    });

    it("rechaza una correcta que no está entre las opciones enviadas", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
        data: {
          options: [
            { key: "A", text: "a" },
            { key: "B", text: "b" },
          ],
          correctAnswer: "D",
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
      expect(repo.updated).toEqual([]);
    });

    it("rechaza dejar la pregunta con una sola opción", async () => {
      const r = await new UpdateQuestion(repo).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
        data: { options: [{ key: "A", text: "a" }], correctAnswer: "A" },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("VALIDATION");
    });
  });

  describe("DeleteQuestion", () => {
    it("el autor borra su pregunta", async () => {
      // Sembramos el mapa pregunta→sección para que el fake resuelva la
      // cascada. Con otra pregunta en "s1" (q2), NO debería dispararse el
      // borrado de la sección al eliminar q1.
      repo.seed("q1", "s1");
      repo.seed("q2", "s1");
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(true);
      expect(repo.deleted).toEqual([{ kind: "question", id: "q1" }]);
    });

    it("no borra fuera de BORRADOR (una evaluación publicada ya se imprimió)", async () => {
      await repo.updateStatus("i1", evalId, "PUBLISHED");
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(false);
      expect(repo.deleted).toEqual([]);
    });

    it("cascada: borra la sección si la pregunta era la única de esa sección", async () => {
      // s1 contiene SOLO q1; al eliminarla, la cascada debe borrar s1 también.
      repo.seed("q1", "s1");
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(true);
      // El orden importa: primero la pregunta, luego la sección.
      expect(repo.deleted).toEqual([
        { kind: "question", id: "q1" },
        { kind: "section", id: "s1" },
      ]);
    });

    it("sin cascada: NO borra la sección si quedan más preguntas", async () => {
      // s1 tiene 2 preguntas (q1, q2); borrar q1 NO debe tocar s1.
      repo.seed("q1", "s1");
      repo.seed("q2", "s1");
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(true);
      expect(repo.deleted).toEqual([{ kind: "question", id: "q1" }]);
    });

    it("sin cascada: borrar la última pregunta de s1 NO afecta s2 que sigue llena", async () => {
      // s1 tiene 1 pregunta (q1), s2 tiene 2 preguntas (q2, q3).
      // Al borrar q1 → cascada borra s1, pero NO toca s2.
      repo.seed("q1", "s1");
      repo.seed("q2", "s2");
      repo.seed("q3", "s2");
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q1",
      });
      expect(r.ok).toBe(true);
      expect(repo.deleted).toEqual([
        { kind: "question", id: "q1" },
        { kind: "section", id: "s1" },
      ]);
    });

    it("rechaza si la pregunta no existe (findQuestionSectionId=null)", async () => {
      // q404 nunca fue sembrada → sectionId es null → NotFoundError.
      const r = await new DeleteQuestion(repo, new FakeEvaluationRules()).execute({
        actor: teacher,
        evaluationId: evalId,
        questionId: "q404",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("NOT_FOUND");
      expect(repo.deleted).toEqual([]);
    });
  });
});
