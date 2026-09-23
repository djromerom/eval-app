import { beforeEach, describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import { type Bundle, type BundleRepository } from "@/modules/bundles/domain/bundle";
import {
  type DisabledBundleQuestion,
  type DisabledBundleQuestionRepository,
} from "@/modules/bundles/domain/disabled-bundle-question";
import { GetBundleQuestionsForToggle } from "@/modules/bundles/application/get-bundle-questions-for-toggle";
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

/** Pregunta seedeable por el stub para el nuevo método `listQuestionsForBundle`. */
interface SeedQuestion {
  id: string;
  evaluationId: string;
  evaluationTitle: string;
  evaluationOrder: number;
  sectionOrder: number;
  sectionTitle: string | null;
  number: number;
  /** TipTap JSON crudo — el use case lo pasa intacto al caller. */
  text: unknown;
}

/** Forma que ve el stub: bundle → items → sections → questions, en orden. */
interface SeedQuestionsByBundle {
  questions: SeedQuestion[];
  hasScanBatch?: boolean;
}

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
  /** Seed para `listQuestionsForBundle` — null si el bundle no existe. */
  byBundle = new Map<string, SeedQuestionsByBundle | null>();

  async listActiveByBundle(bundleId: string): Promise<DisabledBundleQuestion[]> {
    return Array.from(this.rows.values()).filter((r) => r.bundleId === bundleId && r.disabled);
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
    const seed = this.byBundle.get(bundleId);
    if (seed === undefined || seed === null) return seed === undefined ? null : null;
    const blocked = new Set(
      Array.from(this.rows.values())
        .filter((r) => r.disabled && r.bundleId === bundleId)
        .map((r) => r.questionId),
    );
    return seed.questions.map((q) => q.id).filter((id) => !blocked.has(id));
  }
  async bundleHasAnyScanBatch(bundleId: string): Promise<boolean> {
    const seed = this.byBundle.get(bundleId);
    return seed?.hasScanBatch ?? this.hasScanBatch;
  }
  async listAllQuestionIdsForBundle(bundleId: string): Promise<string[] | null> {
    const seed = this.byBundle.get(bundleId);
    if (seed === undefined) return null;
    if (seed === null) return null;
    return seed.questions.map((q) => q.id);
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
    const seed = this.byBundle.get(bundleId);
    if (seed === undefined) return null;
    if (seed === null) return null;
    // El repo Prisma ordena por item.order → section.order → question.number;
    // el stub ya recibe las questions en ese orden, las proyecta tal cual.
    return seed.questions.map((q) => ({
      questionId: q.id,
      evaluationId: q.evaluationId,
      evaluationTitle: q.evaluationTitle,
      evaluationOrder: q.evaluationOrder,
      // SectionId se simula con un derivado estable para los tests que lo necesitan.
      sectionId: `sec-${q.evaluationId}-${q.sectionOrder}`,
      sectionOrder: q.sectionOrder,
      sectionTitle: q.sectionTitle,
      questionNumber: q.number,
      statementJson: q.text,
    }));
  }
}

function bundle(id: string, institutionId: string, status: Bundle["status"] = "DRAFT"): Bundle {
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
    status,
    theme: null,
    coverContent: null,
    evaluationDate: null,
    createdById: "u-super",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** TipTap JSON mínimo representativo para verificar que pasa intacto. */
const SAMPLE_TIPTAP = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "¿Cuál es la capital de Francia?" }],
    },
  ],
};

let disabledRepo: InMemoryDisabledBundleQuestionRepository;
let bundleRepo: StubBundleRepository;
let useCase: GetBundleQuestionsForToggle;

beforeEach(() => {
  disabledRepo = new InMemoryDisabledBundleQuestionRepository();
  const bundles = new Map<string, Bundle>();
  bundles.set("b-1", bundle("b-1", "inst-1"));
  bundleRepo = new StubBundleRepository(bundles);
  useCase = new GetBundleQuestionsForToggle(
    bundleRepo as unknown as BundleRepository,
    disabledRepo,
  );
});

describe("GetBundleQuestionsForToggle - permisos y tenant", () => {
  it("rechaza a TEACHER (solo ECU_MASTER / ECU_LIDER)", async () => {
    disabledRepo.byBundle.set("b-1", { questions: [] });
    const r = await useCase.execute({ actor: teacher, bundleId: "b-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("ECU_LIDER puede leer", async () => {
    disabledRepo.byBundle.set("b-1", { questions: [] });
    const r = await useCase.execute({ actor: ecuLider, bundleId: "b-1" });
    expect(r.ok).toBe(true);
  });

  it("rechaza al actor de otra institucion con NOT_FOUND", async () => {
    disabledRepo.byBundle.set("b-1", { questions: [] });
    const r = await useCase.execute({ actor: anotherTenant, bundleId: "b-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("GetBundleQuestionsForToggle - existencia del bundle", () => {
  it("devuelve NOT_FOUND si el bundle no existe", async () => {
    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-fantasma" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("devuelve NOT_FOUND si el bundle existe pero el repo no tiene preguntas", async () => {
    // Caso degenerado: bundle existe para findById pero listQuestionsForBundle
    // devuelve null (data inconsistente) → seguimos tratando como NOT_FOUND.
    disabledRepo.byBundle.set("b-1", null);
    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("GetBundleQuestionsForToggle - happy path", () => {
  it("bundle DRAFT con 3 preguntas, 0 inhabitadas: orden estable, disabledCount=0", async () => {
    disabledRepo.byBundle.set("b-1", {
      questions: [
        {
          id: "q1",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "Sec 1",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
        {
          id: "q2",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "Sec 1",
          number: 2,
          text: SAMPLE_TIPTAP,
        },
        {
          id: "q3",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 2,
          sectionTitle: "Sec 2",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
      ],
    });

    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.bundleStatus).toBe("DRAFT");
    expect(r.value.hasAnyScanBatch).toBe(false);
    expect(r.value.totalQuestions).toBe(3);
    expect(r.value.disabledCount).toBe(0);
    expect(r.value.questions.map((q) => q.bundlePosition)).toEqual([1, 2, 3]);
    expect(r.value.questions.map((q) => q.questionId)).toEqual(["q1", "q2", "q3"]);
    expect(r.value.questions.every((q) => q.disabled === false)).toBe(true);
    expect(r.value.questions.every((q) => q.disabledAt === null)).toBe(true);
  });

  it("hidrata inhabitaciones: q2 inhabitada → disabled=true, disabledAt y disabledByUserId presentes", async () => {
    disabledRepo.byBundle.set("b-1", {
      questions: [
        {
          id: "q1",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "Sec 1",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
        {
          id: "q2",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "Sec 1",
          number: 2,
          text: SAMPLE_TIPTAP,
        },
        {
          id: "q3",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 2,
          sectionTitle: "Sec 2",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
      ],
    });
    disabledRepo.rows.set("b-1__q2", {
      id: "dbq-x",
      bundleId: "b-1",
      questionId: "q2",
      disabledAt: new Date("2026-09-22T00:00:00Z"),
      disabledByUserId: "u-docente",
      disabled: true,
    });

    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.disabledCount).toBe(1);
    const q2 = r.value.questions.find((q) => q.questionId === "q2");
    expect(q2?.disabled).toBe(true);
    expect(q2?.disabledAt?.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(q2?.disabledByUserId).toBe("u-docente");
    // Las otras siguen enabled.
    expect(r.value.questions.find((q) => q.questionId === "q1")?.disabled).toBe(false);
    expect(r.value.questions.find((q) => q.questionId === "q3")?.disabled).toBe(false);
  });

  it("numeración global 1-based: 2 items (eval A=2preg, eval B=1preg) → bundlePosition 1,2,3", async () => {
    disabledRepo.byBundle.set("b-1", {
      questions: [
        {
          id: "q1",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "Sec A1",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
        {
          id: "q2",
          evaluationId: "e1",
          evaluationTitle: "Eval A",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "Sec A1",
          number: 2,
          text: SAMPLE_TIPTAP,
        },
        {
          id: "q3",
          evaluationId: "e2",
          evaluationTitle: "Eval B",
          evaluationOrder: 2,
          sectionOrder: 1,
          sectionTitle: "Sec B1",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
      ],
    });

    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions.map((q) => q.bundlePosition)).toEqual([1, 2, 3]);
    expect(r.value.questions.map((q) => q.evaluationOrder)).toEqual([1, 1, 2]);
    expect(r.value.questions.map((q) => q.evaluationTitle)).toEqual(["Eval A", "Eval A", "Eval B"]);
  });

  it("preserva el statementJson (TipTap) intacto — sin truncar ni parsear", async () => {
    const complexTipTap = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Texto con " },
            { type: "text", marks: [{ type: "bold" }], text: "negrita" },
            { type: "text", text: " y más." },
          ],
        },
      ],
    };
    disabledRepo.byBundle.set("b-1", {
      questions: [
        {
          id: "q1",
          evaluationId: "e1",
          evaluationTitle: "Eval",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "S",
          number: 1,
          text: complexTipTap,
        },
      ],
    });

    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.questions[0]?.statementJson).toEqual(complexTipTap);
  });
});

describe("GetBundleQuestionsForToggle - lock pre-scan", () => {
  it("refleja hasAnyScanBatch=true en la vista (lock UI; banner + switches disabled)", async () => {
    disabledRepo.byBundle.set("b-1", {
      questions: [
        {
          id: "q1",
          evaluationId: "e1",
          evaluationTitle: "Eval",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "S",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
      ],
      hasScanBatch: true,
    });

    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.hasAnyScanBatch).toBe(true);
  });

  it("NO bloquea la lectura por bundle.status=READY sin escaneos (solo lectura)", async () => {
    const bundles = new Map<string, Bundle>();
    bundles.set("b-ready", bundle("b-ready", "inst-1", "READY"));
    bundleRepo = new StubBundleRepository(bundles);
    useCase = new GetBundleQuestionsForToggle(
      bundleRepo as unknown as BundleRepository,
      disabledRepo,
    );
    disabledRepo.byBundle.set("b-ready", {
      questions: [
        {
          id: "q1",
          evaluationId: "e1",
          evaluationTitle: "Eval",
          evaluationOrder: 1,
          sectionOrder: 1,
          sectionTitle: "S",
          number: 1,
          text: SAMPLE_TIPTAP,
        },
      ],
    });

    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-ready" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // La vista expone status; no falla la lectura. El lock al mutar
    // (ToggleDisabledBundleQuestion) lo enforza el use case de mutación.
    expect(r.value.bundleStatus).toBe("READY");
  });
});

describe("GetBundleQuestionsForToggle - bundle vacio", () => {
  it("bundle con 0 preguntas: totalQuestions=0, questions=[], disabledCount=0", async () => {
    disabledRepo.byBundle.set("b-1", { questions: [] });
    const r = await useCase.execute({ actor: superAdmin, bundleId: "b-1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalQuestions).toBe(0);
    expect(r.value.questions).toEqual([]);
    expect(r.value.disabledCount).toBe(0);
  });
});
