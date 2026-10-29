import { beforeEach, describe, expect, it } from "vitest";
import { ListEvaluations } from "@/modules/evaluations/application/manage-evaluations";
import type {
  CreateEvaluationData,
  Evaluation,
  EvaluationDetail,
  EvaluationListItem,
  EvaluationRepository,
  EvaluationSection,
  Question,
  UpdateEvaluationSettingsData,
} from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  LeaderAssignment,
  LeaderAssignmentRepository,
} from "@/modules/leader-assignments/domain/leader-assignment";

/**
 * Filtro por prueba de `ListEvaluations` (oct 2026).
 *
 * "Mis formulaciones" solo debe mostrar las formulaciones de la PRUEBA
 * ACTUAL (la marcada con `Period.isCurrent`). El page resuelve cuál es esa
 * prueba y la pasa como `periodId`; si la institución no tiene ninguna
 * prueba actual marcada, NO pasa el filtro (el docente ve todas).
 */
class FakeEvaluations implements EvaluationRepository {
  items: Evaluation[] = [];
  /** Último `periodId` que recibió cada método de listado. */
  calls: { metodo: string; periodId?: string }[] = [];

  private list(periodId?: string): EvaluationListItem[] {
    return this.items
      .filter((e) => (periodId ? e.periodId === periodId : true))
      .map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        version: e.version,
        bookletNumber: e.bookletNumber,
        totalQuestions: e.totalQuestions,
        courseId: "c1",
        courseName: "11°",
        subjectName: "Matemáticas",
        courseSubjectId: e.courseSubjectId,
        periodId: e.periodId,
        periodName: e.periodId === "p-actual" ? "2026-3" : "2026-2",
        bookletTypeId: e.bookletTypeId,
        bookletTypeName: null,
        academicYearYear: 2026,
        teacherName: "Docente",
        updatedAt: new Date("2026-01-01"),
      }));
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
      durationMinutes: null,
      theme: null,
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
  async findByTeacher(
    _institutionId: string,
    _teacherId: string,
    periodId?: string,
  ): Promise<EvaluationListItem[]> {
    this.calls.push({ metodo: "findByTeacher", periodId });
    return this.list(periodId);
  }
  async findByInstitution(
    _institutionId: string,
    _status?: EvaluationStatus,
    periodId?: string,
  ): Promise<EvaluationListItem[]> {
    this.calls.push({ metodo: "findByInstitution", periodId });
    return this.list(periodId);
  }
  async findByCourseIds(
    _institutionId: string,
    courseIds: string[],
    _status?: EvaluationStatus,
    periodId?: string,
  ): Promise<EvaluationListItem[]> {
    this.calls.push({ metodo: "findByCourseIds", periodId });
    if (courseIds.length === 0) return [];
    return this.list(periodId);
  }
  async addSection(): Promise<EvaluationSection> {
    throw new Error("no usado");
  }
  async addQuestion(): Promise<Question> {
    throw new Error("no usado");
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
  async findQuestionSectionId(): Promise<string | null> {
    throw new Error("no usado");
  }
  async deleteQuestion(): Promise<void> {
    throw new Error("no usado");
  }
  async countQuestionsInSection(): Promise<number> {
    throw new Error("no usado");
  }
  async reorderQuestions(): Promise<void> {
    throw new Error("no usado");
  }
  async duplicateQuestion(): Promise<void> {
    throw new Error("no usado");
  }
  async updateStatus(_i: string, id: string, status: EvaluationStatus) {
    const e = this.items.find((x) => x.id === id);
    if (e) e.status = status;
  }
  async findCourseIdByEvaluation(): Promise<string | null> {
    return null;
  }
  async updateSettings(
    _i: string,
    id: string,
    _data: UpdateEvaluationSettingsData,
  ): Promise<Evaluation> {
    const e = this.items.find((x) => x.id === id);
    if (!e) throw new Error(`Evaluation ${id} no encontrada`);
    return e;
  }
  async createNewVersion(): Promise<Evaluation> {
    throw new Error("no usado");
  }
  async existsByCourseSubjectPeriodBookletTypeYear(): Promise<boolean> {
    return false;
  }
}

class FakeLeaderAssignments implements LeaderAssignmentRepository {
  async listAssignedCourseIds(): Promise<string[]> {
    return ["c1"];
  }
  async assign(): Promise<void> {
    throw new Error("no usado");
  }
  async unassign(): Promise<void> {
    throw new Error("no usado");
  }
  async isAssigned(): Promise<boolean> {
    return false;
  }
  async listAssignments(): Promise<LeaderAssignment[]> {
    return [];
  }
}

const teacher: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "inst1",
  roles: ["TEACHER"],
};

const leader: AuthenticatedUser = {
  userId: "u-leader",
  institutionId: "inst1",
  roles: ["ECU_LIDER"],
};

const master: AuthenticatedUser = {
  userId: "u-master",
  institutionId: "inst1",
  roles: ["ECU_MASTER"],
};

describe("ListEvaluations — filtro por prueba (prueba actual)", () => {
  let repo: FakeEvaluations;
  let useCase: ListEvaluations;

  beforeEach(() => {
    repo = new FakeEvaluations();
    useCase = new ListEvaluations(repo, new FakeLeaderAssignments());
  });

  /** Una formulación de la prueba anterior y otra de la actual. */
  function seed() {
    repo.items = [
      {
        id: "e-1",
        institutionId: "inst1",
        teacherId: "u-teacher",
        title: "Formulación 2026-2",
        description: null,
        version: 1,
        status: "PUBLISHED",
        courseSubjectId: "cs-1",
        academicYearId: "ay1",
        periodId: "p-anterior",
        bookletNumber: null,
        bookletTypeId: null,
        totalQuestions: 20,
        durationMinutes: null,
        theme: null,
      },
      {
        id: "e-2",
        institutionId: "inst1",
        teacherId: "u-teacher",
        title: "Formulación 2026-3",
        description: null,
        version: 1,
        status: "DRAFT",
        courseSubjectId: "cs-1",
        academicYearId: "ay1",
        periodId: "p-actual",
        bookletNumber: null,
        bookletTypeId: null,
        totalQuestions: 0,
        durationMinutes: null,
        theme: null,
      },
    ];
  }

  it("el docente solo ve las formulaciones de la prueba indicada", async () => {
    seed();
    const res = await useCase.execute({ actor: teacher, periodId: "p-actual" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((e) => e.id)).toEqual(["e-2"]);
    expect(res.value[0]?.periodName).toBe("2026-3");
  });

  it("sin periodId no filtra: el docente ve todas sus formulaciones", async () => {
    seed();
    const res = await useCase.execute({ actor: teacher });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((e) => e.id).sort()).toEqual(["e-1", "e-2"]);
    expect(repo.calls.at(-1)?.periodId).toBeUndefined();
  });

  it("el filtro también aplica al ECU_MASTER (scope institucional)", async () => {
    seed();
    const res = await useCase.execute({ actor: master, periodId: "p-actual" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((e) => e.id)).toEqual(["e-2"]);
    expect(repo.calls.at(-1)?.metodo).toBe("findByInstitution");
  });

  it("el filtro también aplica al ECU_LIDER (scope por cursos asignados)", async () => {
    seed();
    const res = await useCase.execute({ actor: leader, periodId: "p-actual" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((e) => e.id)).toEqual(["e-2"]);
    expect(repo.calls.at(-1)?.metodo).toBe("findByCourseIds");
  });

  it("sin periodId el ECU_LIDER sigue viendo todo su scope", async () => {
    seed();
    const res = await useCase.execute({ actor: leader });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.length).toBe(2);
  });
});
