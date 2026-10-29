import { beforeEach, describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import { type Bundle, type BundleRepository } from "@/modules/bundles/domain/bundle";
import {
  type DisabledBundleQuestion,
  type DisabledBundleQuestionRepository,
} from "@/modules/bundles/domain/disabled-bundle-question";
import { ToggleDisabledBundleQuestion } from "@/modules/bundles/application/toggle-disabled-bundle-question";
import { superAdmin, teacher } from "./bundles-shared";

const ecuLider: AuthenticatedUser = {
  userId: "u-lider",
  institutionId: "inst-1",
  roles: ["ECU_LIDER"],
};

const anotherTenant: AuthenticatedUser = {
  userId: "u-other",
  institutionId: "inst-2",
  roles: ["ECU_MASTER"],
};

class StubBundleRepository implements Pick<BundleRepository, "findById"> {
  constructor(private readonly bundles: Map<string, Bundle>) {}
  async findById(institutionId: string, id: string): Promise<Bundle | null> {
    const b = this.bundles.get(id);
    return b && b.institutionId === institutionId ? b : null;
  }
}

class InMemoryDisabledBundleQuestionRepository implements DisabledBundleQuestionRepository {
  rows = new Map<string, DisabledBundleQuestion>();
  hasScanBatch = false;
  allByBundle = new Map<string, Set<string>>();

  async listActiveByBundle(_bundleId: string): Promise<DisabledBundleQuestion[]> {
    return Array.from(this.rows.values()).filter((r) => r.disabled);
  }
  async setDisabled(args: {
    bundleId: string;
    questionId: string;
    disabled: boolean;
    actorUserId: string;
  }): Promise<DisabledBundleQuestion> {
    const key = `${args.bundleId}__${args.questionId}`;
    const existing = this.rows.get(key);
    const row: DisabledBundleQuestion = {
      id: existing?.id ?? `dbq-${this.rows.size + 1}`,
      bundleId: args.bundleId,
      questionId: args.questionId,
      disabledAt: new Date(),
      disabledByUserId: args.actorUserId,
      disabled: args.disabled,
    };
    this.rows.set(key, row);
    return row;
  }
  async effectiveQuestionIds(bundleId: string): Promise<string[] | null> {
    const all = await this.listAllQuestionIdsForBundle(bundleId);
    if (all === null) return null;
    const blocked = new Set(
      Array.from(this.rows.values())
        .filter((r) => r.disabled && r.bundleId === bundleId)
        .map((r) => r.questionId),
    );
    return all.filter((q) => !blocked.has(q));
  }
  async bundleHasAnyScanBatch(_bundleId: string): Promise<boolean> {
    return this.hasScanBatch;
  }
  async listAllQuestionIdsForBundle(bundleId: string): Promise<string[] | null> {
    const all = this.allByBundle.get(bundleId);
    return all === undefined ? null : Array.from(all);
  }
  async listQuestionsForBundle(bundleId: string): Promise<
    | {
        questionId: string;
        evaluationId: string;
        evaluationTitle: string;
        evaluationOrder: number;
        sectionId: string;
        sectionOrder: number;
        sectionTitle: string | null;
        questionNumber: number;
        statementJson: unknown;
      }[]
    | null
  > {
    // Este stub solo implementa lo que necesita ToggleDisabledBundleQuestion;
    // los tests de GetBundleQuestionsForToggle tienen su propio stub más rico.
    const all = this.allByBundle.get(bundleId);
    return all === undefined
      ? null
      : Array.from(all).map((id) => ({
          questionId: id,
          evaluationId: "unused",
          evaluationTitle: "unused",
          evaluationOrder: 0,
          sectionId: "unused",
          sectionOrder: 0,
          sectionTitle: null,
          questionNumber: 0,
          statementJson: null,
        }));
  }
}

function bundle(id: string, institutionId: string): Bundle {
  return {
    id,
    institutionId,
    name: `Bundle ${id}`,
    bookletNumber: null,
    courseId: null,
    courseName: null,
    periodId: null,
    periodName: null,
    bookletTypeId: null,
    bookletTypeName: null,
    status: "DRAFT",
    theme: null,
    coverContent: null,
    evaluationDate: null,
    createdById: "u-super",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let disabledRepo: InMemoryDisabledBundleQuestionRepository;
let bundleRepo: StubBundleRepository;
let useCase: ToggleDisabledBundleQuestion;

beforeEach(() => {
  disabledRepo = new InMemoryDisabledBundleQuestionRepository();
  const bundles = new Map<string, Bundle>();
  bundles.set("b-1", bundle("b-1", "inst-1"));
  bundleRepo = new StubBundleRepository(bundles);
  disabledRepo.allByBundle.set("b-1", new Set(["q1", "q2", "q3"]));
  useCase = new ToggleDisabledBundleQuestion(
    bundleRepo as unknown as BundleRepository,
    disabledRepo,
  );
});

describe("ToggleDisabledBundleQuestion - permisos y tenant", () => {
  it("rechaza a TEACHER (solo ECU_MASTER / ECU_LIDER)", async () => {
    const r = await useCase.execute({
      actor: teacher,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("ECU_LIDER puede inhabitar", async () => {
    const r = await useCase.execute({
      actor: ecuLider,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza al actor de otra institucion con NOT_FOUND", async () => {
    const r = await useCase.execute({
      actor: anotherTenant,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("ToggleDisabledBundleQuestion - lock pre-scan", () => {
  it("bloquea toggling cuando ya hay ScanBatch apuntando al bundle", async () => {
    disabledRepo.hasScanBatch = true;
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.message).toMatch(/escaneadas/);
    }
  });

  it("permite toggling cuando NO hay ScanBatch", async () => {
    disabledRepo.hasScanBatch = false;
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(true);
  });
});

describe("ToggleDisabledBundleQuestion - pertenencia al bundle", () => {
  it("rechaza si la pregunta no pertenece al bundle", async () => {
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q-fantasma",
      disabled: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.message).toMatch(/no pertenece a este cuadernillo/);
    }
  });
});

describe("ToggleDisabledBundleQuestion - bloquea dejar el bundle vacio", () => {
  it("permite inhabitar si quedan efectivas", async () => {
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza inhabitar la ultima efectiva", async () => {
    disabledRepo.rows.set("b-1__q1", {
      id: "dbq-old-1",
      bundleId: "b-1",
      questionId: "q1",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    disabledRepo.rows.set("b-1__q2", {
      id: "dbq-old-2",
      bundleId: "b-1",
      questionId: "q2",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q3",
      disabled: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.message).toMatch(/al menos una pregunta efectiva/);
    }
  });

  it("ignora filas huérfanas de preguntas que ya no están en el cuadernillo", async () => {
    // q-vieja quedó inhabilitada en una formulación que se quitó del
    // cuadernillo. Con q1 y q2 ya inhabilitadas, inhabitar q3 debe fallar
    // (0 efectivas), pero inhabitar solo q1 con q-vieja huérfana debe pasar:
    // antes, la huérfana restaba una efectiva que no existe.
    disabledRepo.rows.set("b-1__q-vieja", {
      id: "dbq-huerfana",
      bundleId: "b-1",
      questionId: "q-vieja",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    disabledRepo.rows.set("b-1__q2", {
      id: "dbq-old-2",
      bundleId: "b-1",
      questionId: "q2",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    // Preguntas actuales: q1, q2, q3. Inhabilitadas reales: q2. Inhabitar q1
    // deja q3 efectiva → válido.
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(true);
  });

  it("re-habilitar siempre pasa el guard (nunca puede dejar vacio)", async () => {
    disabledRepo.rows.set("b-1__q1", {
      id: "dbq-old-1",
      bundleId: "b-1",
      questionId: "q1",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    disabledRepo.rows.set("b-1__q2", {
      id: "dbq-old-2",
      bundleId: "b-1",
      questionId: "q2",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    disabledRepo.rows.set("b-1__q3", {
      id: "dbq-old-3",
      bundleId: "b-1",
      questionId: "q3",
      disabledAt: new Date(),
      disabledByUserId: "u-x",
      disabled: true,
    });
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe("ToggleDisabledBundleQuestion - persistencia", () => {
  it("re-toggling al mismo estado no es error y reusa la fila", async () => {
    await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    const r = await useCase.execute({
      actor: superAdmin,
      bundleId: "b-1",
      questionId: "q1",
      disabled: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(disabledRepo.rows.size).toBe(1);
  });
});
