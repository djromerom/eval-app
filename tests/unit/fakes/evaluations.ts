/**
 * Repo de evaluaciones MINIMALISTA que implementa la interfaz completa
 * `EvaluationRepository`, para tests de aplicación que no necesitan la BD.
 *
 * Solo las operaciones que se ejercitan tienen comportamiento real; el resto
 * son stubs tipados para que `tsc --noEmit` pase sin casts.
 */
import type {
  CreateEvaluationData,
  CreateQuestionData,
  CreateSectionData,
  Evaluation,
  EvaluationDetail,
  EvaluationListItem,
  EvaluationRepository,
  EvaluationSection,
  Question,
  UpdateEvaluationSettingsData,
  UpdateQuestionData,
  UpdateSectionData,
} from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";

export class FakeEvaluations implements EvaluationRepository {
  items: Evaluation[] = [];
  /** Detalle que devuelve `getDetail` (para leer preguntas y contextos). */
  detail: EvaluationDetail | null = null;
  addQuestionCalls = 0;
  deleteQuestionCalls = 0;
  duplicateQuestionCalls = 0;
  statusUpdates: EvaluationStatus[] = [];
  /** Preguntas que pasaron por `addQuestion` (para inspeccionar). */
  addedQuestions: { sectionId: string; data: CreateQuestionData }[] = [];
  /** Secciones creadas con `addSection`. */
  addedSections: CreateSectionData[] = [];

  async findById(institutionId: string, id: string) {
    return this.items.find((e) => e.institutionId === institutionId && e.id === id) ?? null;
  }
  async getDetail(_institutionId: string, _id: string) {
    return this.detail;
  }
  async addQuestion(
    _institutionId: string,
    evaluationId: string,
    sectionId: string,
    data: CreateQuestionData,
  ) {
    this.addQuestionCalls += 1;
    this.addedQuestions.push({ sectionId, data });
    const e = this.items.find((x) => x.id === evaluationId);
    if (e) e.totalQuestions += 1;
    return {} as Question;
  }
  async updateQuestion(
    _institutionId: string,
    _evaluationId: string,
    _questionId: string,
    _data: UpdateQuestionData,
  ) {
    return {} as Question;
  }
  async deleteQuestion(_i: string, evaluationId: string, _qid: string) {
    this.deleteQuestionCalls += 1;
    const e = this.items.find((x) => x.id === evaluationId);
    if (e) e.totalQuestions = Math.max(0, e.totalQuestions - 1);
  }
  async duplicateQuestion(_i: string, evaluationId: string, _qid: string) {
    this.duplicateQuestionCalls += 1;
    const e = this.items.find((x) => x.id === evaluationId);
    if (e) e.totalQuestions += 1;
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
  async updateStatus(_i: string, id: string, status: EvaluationStatus) {
    const e = this.items.find((x) => x.id === id);
    if (e) e.status = status;
    this.statusUpdates.push(status);
  }
  async addSection(
    _institutionId: string,
    _evaluationId: string,
    data: CreateSectionData,
  ): Promise<EvaluationSection> {
    this.addedSections.push(data);
    return {
      id: `sec${this.addedSections.length}`,
      title: data.title ?? null,
      content: data.content ?? { type: "doc", content: [] },
      order: this.addedSections.length,
      questions: [],
      columnLayoutOverride: data.columnLayoutOverride ?? null,
    };
  }
  async updateSection(
    _institutionId: string,
    _evaluationId: string,
    _sectionId: string,
    _data: UpdateSectionData,
  ): Promise<EvaluationSection> {
    return {} as EvaluationSection;
  }
  async reorderQuestions(_i: string, _eid: string, _sid: string, _ids: string[]) {
    /* noop */
  }

  // Métodos no ejercitados — stubs tipados con retornos neutrales.
  async create(_i: string, _t: string, _d: CreateEvaluationData): Promise<Evaluation> {
    throw new Error("noop");
  }
  async findByTeacher(_i: string, _t: string) {
    return [] as EvaluationListItem[];
  }
  async findByInstitution(_i: string) {
    return [] as EvaluationListItem[];
  }
  async findByCourseIds(_i: string, _courseIds: string[]) {
    return [] as EvaluationListItem[];
  }
  async updateSettings(_i: string, _id: string, _d: UpdateEvaluationSettingsData): Promise<never> {
    return {} as never;
  }
  async createNewVersion(_i: string, _id: string): Promise<never> {
    return {} as never;
  }
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
