import { beforeEach, describe, expect, it } from "vitest";
import { UpdateEvaluationSettings } from "@/modules/evaluations/application/manage-evaluations";
import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  validateDurationMinutes,
} from "@/modules/evaluations/domain/evaluation";
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
  async findByTeacher(): Promise<EvaluationListItem[]> {
    return [];
  }
  async findByInstitution(): Promise<EvaluationListItem[]> {
    return [];
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
  async deleteQuestion(): Promise<void> {
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
  async existsByCourseSubjectPeriodYear(): Promise<boolean> {
    return false;
  }
}

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
const coordinator: AuthenticatedUser = {
  userId: "c1",
  institutionId: "i1",
  roles: ["COORDINATOR"],
};

describe("validateDurationMinutes (Sprint 7)", () => {
  it("null es válido (resetea al cálculo heurístico)", () => {
    expect(validateDurationMinutes(null)).toBeNull();
  });

  it("acepta 1 y 600 (cotas)", () => {
    expect(validateDurationMinutes(MIN_DURATION_MINUTES)).toBeNull();
    expect(validateDurationMinutes(MAX_DURATION_MINUTES)).toBeNull();
  });

  it("rechaza 0, negativos y >600", () => {
    expect(validateDurationMinutes(0)).not.toBeNull();
    expect(validateDurationMinutes(-5)).not.toBeNull();
    expect(validateDurationMinutes(MAX_DURATION_MINUTES + 1)).not.toBeNull();
  });

  it("rechaza floats (no enteros)", () => {
    expect(validateDurationMinutes(45.5)).not.toBeNull();
    expect(validateDurationMinutes(NaN)).not.toBeNull();
  });
});

describe("UpdateEvaluationSettings (Sprint 7)", () => {
  let repo: FakeEvaluations;
  let evalId: string;
  let uc: UpdateEvaluationSettings;

  beforeEach(async () => {
    repo = new FakeEvaluations();
    uc = new UpdateEvaluationSettings(repo);
    const created = await repo.create("i1", "t1", { title: "T1", courseSubjectId: "cs1" });
    evalId = created.id;
  });

  it("persiste durationMinutes del dueño en DRAFT", async () => {
    const r = await uc.execute({
      actor: teacher,
      evaluationId: evalId,
      data: { durationMinutes: 90 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.durationMinutes).toBe(90);

    const stored = await repo.findById("i1", evalId);
    expect(stored?.durationMinutes).toBe(90);
  });

  it("permite reset a null (recae al cálculo heurístico)", async () => {
    await uc.execute({ actor: teacher, evaluationId: evalId, data: { durationMinutes: 90 } });
    const r = await uc.execute({
      actor: teacher,
      evaluationId: evalId,
      data: { durationMinutes: null },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.durationMinutes).toBeNull();
  });

  it("rechaza valores fuera de rango", async () => {
    const r = await uc.execute({
      actor: teacher,
      evaluationId: evalId,
      data: { durationMinutes: 0 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza si la evaluation no está en DRAFT (APPROVED)", async () => {
    await repo.updateStatus("i1", evalId, "APPROVED");
    const r = await uc.execute({
      actor: teacher,
      evaluationId: evalId,
      data: { durationMinutes: 60 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza si la evaluation no está en DRAFT (PUBLISHED)", async () => {
    await repo.updateStatus("i1", evalId, "PUBLISHED");
    const r = await uc.execute({
      actor: teacher,
      evaluationId: evalId,
      data: { durationMinutes: 60 },
    });
    expect(r.ok).toBe(false);
  });

  it("rechaza a un TEACHER que no es dueño (FORBIDDEN/NOT_FOUND)", async () => {
    const r = await uc.execute({
      actor: otherTeacher,
      evaluationId: evalId,
      data: { durationMinutes: 30 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("COORDINATOR puede editar la duración de una evaluation ajena", async () => {
    const r = await uc.execute({
      actor: coordinator,
      evaluationId: evalId,
      data: { durationMinutes: 75 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.durationMinutes).toBe(75);
  });

  it("rechaza si la evaluation no existe", async () => {
    const r = await uc.execute({
      actor: teacher,
      evaluationId: "ghost",
      data: { durationMinutes: 60 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});
