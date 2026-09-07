/**
 * Tests end-to-end del ZIP LaTeX (L11 — sep 2026).
 * =================================================
 *
 * Cubre los caminos críticos del use case `BuildLatexZip` orquestador:
 *   • Auth: roles sin permiso reciben ForbiddenError.
 *   • Bundle inexistente → NotFoundError.
 *   • Cap defensivo de 50 items.
 *   • Empty bundle.
 *   • Happy path: 1 evaluation → ZIP con archivos esperados.
 *   • Numbering continuo entre varias evaluations.
 *   • Imagen externa (https) → omitida con comentario.
 *   • Imagen con ENOENT (readUpload → null) → omitida del ZIP.
 *   • Math (inlineMath + blockMath) → renderiza $..$ y \[..\].
 *
 * Estrategia: fakes in-memory para los 3 puertos (`loadBundle`,
 * `loadEvaluation`, `readUpload`). Sin Prisma, sin disco, sin red.
 */

// @vitest-environment node
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type { BundleDetail } from "@/modules/bundles/domain/bundle";
import type {
  EvaluationDetail,
  Question,
  QuestionOption,
} from "@/modules/evaluations/domain/evaluation";

import { BuildLatexZip } from "@/modules/latex-export/application/build-latex-zip";
import type { ReadUpload } from "@/modules/latex-export/infrastructure/prisma-image-fetcher";

// ---------------------------------------------------------------------------
// Fakes mínimos
// ---------------------------------------------------------------------------

function makeActor(roles: AuthenticatedUser["roles"]): AuthenticatedUser {
  return {
    userId: "u-test",
    institutionId: "inst-A",
    roles,
  };
}

/** Total de questions por evaluation (lo usa BundleItemDetail.totalQuestions
 *  y luego el assert "numbering continuo"). Se inyecta vía el helper
 *  `withEval` y `setup()` lo lee. */
const evalTotalsRegistry = new Map<string, number>();
function setEvalTotal(id: string, n: number) {
  evalTotalsRegistry.set(id, n);
}

interface BundleRow {
  id: string;
  items: Array<{ id: string; evaluationId: string; order: number }>;
}

class FakeBundleRepo {
  constructor(private rows: BundleRow[]) {}
  async findDetail(_institutionId: string, id: string): Promise<BundleDetail | null> {
    const found = this.rows.find((r) => r.id === id);
    if (!found) return null;
    return {
      id: found.id,
      institutionId: "inst-A",
      name: `Bundle ${found.id}`,
      bookletNumber: 1,
      courseId: null,
      courseName: null,
      periodId: null,
      periodName: null,
      bookletTypeId: null,
      bookletTypeName: null,
      evaluationDate: null,
      status: "READY" as BundleDetail["status"],
      theme: null,
      coverContent: null,
      createdById: "u-test",
      createdAt: new Date(),
      updatedAt: new Date(),
      items: found.items.map((it) => ({
        id: it.id,
        bundleId: found.id,
        evaluationId: it.evaluationId,
        order: it.order,
        evaluationTitle: `Eval ${it.evaluationId}`,
        evaluationStatus: "APPROVED",
        totalQuestions: evalTotalsRegistry.get(it.evaluationId) ?? 1,
        durationMinutes: 30,
        subjectName: null,
        parentSubjectId: null,
        parentSubjectName: null,
        subjectIsArea: false,
        courseId: "course-A",
        courseName: "11°",
        bookletTypeId: null,
        bookletTypeName: null,
      })),
      totalQuestions: 0,
    };
  }
}

class FakeEvaluationRepo {
  /** Mapa evaluationId → EvaluationDetail (o undefined para simular 404). */
  rows = new Map<string, EvaluationDetail>();
  set(id: string, detail: EvaluationDetail) {
    this.rows.set(id, detail);
  }
  async getDetail(_institutionId: string, id: string): Promise<EvaluationDetail | null> {
    return this.rows.get(id) ?? null;
  }
}

class FakeReadUpload {
  /** Map<storagePath, Buffer | null>. `null` simula ENOENT en disco. */
  private files = new Map<string, Buffer | null>();
  set(path: string, buffer: Buffer | null) {
    this.files.set(path, buffer);
  }
  read: ReadUpload = async (path) => this.files.get(path) ?? null;
}

// ---------------------------------------------------------------------------
// Helpers para construir TipTap JSON fixtures
// ---------------------------------------------------------------------------

type TipTapNode = {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
};

function doc(...content: TipTapNode[]): TipTapNode {
  return { type: "doc", content };
}
function p(...content: TipTapNode[]): TipTapNode {
  return { type: "paragraph", content };
}
function t(text: string): TipTapNode {
  return { type: "text", text };
}
function image(src: string, width?: number): TipTapNode {
  return {
    type: "image",
    attrs: width === undefined ? { src } : { src, width },
  };
}
function inlineMath(tex: string): TipTapNode {
  return { type: "inlineMath", attrs: { tex } };
}
function blockMath(tex: string): TipTapNode {
  return { type: "blockMath", attrs: { tex } };
}

/** Construye un `EvaluationDetail` con 1 section + N questions. */
function makeEvaluation(args: {
  id: string;
  title?: string;
  /** Stems por question (TipTap doc). */
  questionStems: TipTapNode[];
  /** Imágenes por question (mismo índice). `null` = sin imagen. */
  questionImages?: (TipTapNode | null)[];
}): EvaluationDetail {
  const images = args.questionImages ?? args.questionStems.map(() => null);
  const questions: Question[] = args.questionStems.map((stem, idx) => {
    const stemClone = JSON.parse(JSON.stringify(stem)) as TipTapNode;
    const img = images[idx];
    if (img) {
      // Inserta la imagen al inicio del primer paragraph del stem.
      if (stemClone.content && stemClone.content[0]?.type === "paragraph") {
        const firstPara = stemClone.content[0];
        firstPara.content = [img, ...(firstPara.content ?? [])];
      } else {
        stemClone.content = [{ type: "paragraph", content: [img] }, ...(stemClone.content ?? [])];
      }
    }
    const options: QuestionOption[] = [
      { key: "A", text: { type: "doc", content: [p(t("Opción A"))] } },
      { key: "B", text: { type: "doc", content: [p(t("Opción B"))] } },
    ];
    return {
      id: `q-${args.id}-${idx + 1}`,
      number: idx + 1,
      text: stemClone,
      image: null,
      sectionId: "section-1",
      options,
      correctAnswer: "A",
      justification: null,
      weight: 1,
      soloLevel: null,
      menComponent: null,
      competency: null,
    };
  });
  setEvalTotal(args.id, questions.length);
  return {
    id: args.id,
    institutionId: "inst-A",
    title: args.title ?? `Eval ${args.id}`,
    description: null,
    version: 1,
    status: "APPROVED",
    courseSubjectId: "cs-1",
    academicYearId: "ay-1",
    periodId: null,
    teacherId: "u-test",
    bookletNumber: 1,
    bookletTypeId: null,
    totalQuestions: questions.length,
    durationMinutes: 30,
    theme: null,
    sections: [
      {
        id: "section-1",
        title: "Sección 1",
        content: doc(),
        order: 1,
        questions,
        columnLayoutOverride: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

interface Context {
  bundleRepo: FakeBundleRepo;
  evalRepo: FakeEvaluationRepo;
  readUpload: FakeReadUpload;
  useCase: BuildLatexZip;
}

function setup(bundleRows: BundleRow[]): Context {
  const bundleRepo = new FakeBundleRepo(bundleRows);
  const evalRepo = new FakeEvaluationRepo();
  const readUpload = new FakeReadUpload();

  const useCase = new BuildLatexZip({
    loadBundle: (institutionId, bundleId) => bundleRepo.findDetail(institutionId, bundleId),
    loadEvaluation: (institutionId, evaluationId) =>
      evalRepo.getDetail(institutionId, evaluationId),
    readUpload: readUpload.read,
  });

  return { bundleRepo, evalRepo, readUpload, useCase };
}

interface ExtractedZip {
  binaryFiles: Map<string, Buffer>;
  textFiles: Map<string, string>;
}

async function extractZip(zipBuffer: Buffer): Promise<ExtractedZip> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const binaryFiles = new Map<string, Buffer>();
  const textFiles = new Map<string, string>();
  for (const filename of Object.keys(zip.files)) {
    const entry = zip.files[filename];
    if (!entry || entry.dir) continue;
    if (filename.endsWith(".tex") || filename.endsWith(".md")) {
      textFiles.set(filename, await entry.async("string"));
    } else {
      binaryFiles.set(filename, (await entry.async("nodebuffer")) as Buffer);
    }
  }
  return { binaryFiles, textFiles };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BuildLatexZip", () => {
  let ctx: Context;
  beforeEach(() => {
    evalTotalsRegistry.clear();
  });

  // -------------------------------------------------------------------------
  // Auth / scoping
  // -------------------------------------------------------------------------

  it("TEACHER sin permiso recibe ForbiddenError", async () => {
    ctx = setup([{ id: "b1", items: [{ id: "i1", evaluationId: "e1", order: 1 }] }]);
    const actor = makeActor(["TEACHER"]);
    const res = await ctx.useCase.execute({
      actor,
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FORBIDDEN");
  });

  it("bundle inexistente recibe NotFoundError", async () => {
    ctx = setup([]);
    const actor = makeActor(["ECU_MASTER"]);
    const res = await ctx.useCase.execute({
      actor,
      mode: "bundle",
      targetId: "missing",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("bundle vacío (sin items) recibe ForbiddenError", async () => {
    ctx = setup([{ id: "b-empty", items: [] }]);
    const actor = makeActor(["ECU_MASTER"]);
    const res = await ctx.useCase.execute({
      actor,
      mode: "bundle",
      targetId: "b-empty",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FORBIDDEN");
    expect(res.error.message).toMatch(/no tiene formulaciones/);
  });

  it("bundle con 51 formulaciones excede el cap", async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: `i${i + 1}`,
      evaluationId: `e${i + 1}`,
      order: i + 1,
    }));
    ctx = setup([{ id: "b-big", items }]);
    const actor = makeActor(["ECU_MASTER"]);
    const res = await ctx.useCase.execute({
      actor,
      mode: "bundle",
      targetId: "b-big",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FORBIDDEN");
    expect(res.error.message).toMatch(/máximo 50/);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("happy path: 1 evaluation → ZIP con main.tex + eval-1.tex + README.md + images/", async () => {
    const { useCase, evalRepo, readUpload } = setup([
      { id: "b1", items: [{ id: "i1", evaluationId: "e1", order: 1 }] },
    ]);
    evalRepo.set(
      "e1",
      makeEvaluation({
        id: "e1",
        title: "Primer parcial",
        questionStems: [doc(p(t("¿Cuál es la respuesta?")))],
        questionImages: [image("/api/uploads/evaluations/inst-A/q1.png", 80)],
      }),
    );
    readUpload.set("evaluations/inst-A/q1.png", Buffer.from("PNG_BYTES"));

    const res = await useCase.execute({
      actor: makeActor(["ECU_MASTER"]),
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { binaryFiles, textFiles } = await extractZip(res.value.zipBuffer);
    expect(textFiles.has("main.tex")).toBe(true);
    expect(textFiles.has("eval-1.tex")).toBe(true);
    expect(textFiles.has("README.md")).toBe(true);
    expect(binaryFiles.has("images/img-1.png")).toBe(true);
    expect(res.value.filename).toMatch(/^cuadernillo-b1-.*\.zip$/);
  });

  // -------------------------------------------------------------------------
  // Numbering continuo entre evaluations
  // -------------------------------------------------------------------------

  it("numbering continuo: eval-2 empieza en N+1 del eval-1", async () => {
    const { useCase, evalRepo } = setup([
      {
        id: "b1",
        items: [
          { id: "i1", evaluationId: "e1", order: 1 },
          { id: "i2", evaluationId: "e2", order: 2 },
        ],
      },
    ]);
    evalRepo.set(
      "e1",
      makeEvaluation({
        id: "e1",
        title: "Eval 1",
        questionStems: Array.from({ length: 5 }, (_, i) => doc(p(t(`Q${i + 1}`)))),
      }),
    );
    evalRepo.set(
      "e2",
      makeEvaluation({
        id: "e2",
        title: "Eval 2",
        questionStems: Array.from({ length: 3 }, (_, i) => doc(p(t(`Q${i + 1}`)))),
      }),
    );

    const res = await useCase.execute({
      actor: makeActor(["ECU_MASTER"]),
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { textFiles } = await extractZip(res.value.zipBuffer);
    const eval2 = textFiles.get("eval-2.tex") ?? "";
    // eval-2 empieza en 6 (5+1).
    expect(eval2).toContain("\\begin{enumerate}[label=\\textbf{\\arabic*.}, start=6]");
  });

  // -------------------------------------------------------------------------
  // Imágenes
  // -------------------------------------------------------------------------

  it("imagen externa (https) → omitida con comentario en el .tex", async () => {
    const { useCase, evalRepo } = setup([
      { id: "b1", items: [{ id: "i1", evaluationId: "e1", order: 1 }] },
    ]);
    evalRepo.set(
      "e1",
      makeEvaluation({
        id: "e1",
        title: "Eval ext",
        questionStems: [doc(p(t("Pregunta con imagen externa")))],
        questionImages: [image("https://cdn.example.com/img.png", 60)],
      }),
    );

    const res = await useCase.execute({
      actor: makeActor(["ECU_MASTER"]),
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { binaryFiles, textFiles } = await extractZip(res.value.zipBuffer);
    const eval1 = textFiles.get("eval-1.tex") ?? "";
    expect(eval1).toContain("% [imagen externa omitida: https://cdn.example.com/img.png]");
    expect(binaryFiles.has("images/img-1.png")).toBe(false);
  });

  it("imagen con ENOENT en storage → omitida del ZIP con comentario", async () => {
    const { useCase, evalRepo, readUpload } = setup([
      { id: "b1", items: [{ id: "i1", evaluationId: "e1", order: 1 }] },
    ]);
    evalRepo.set(
      "e1",
      makeEvaluation({
        id: "e1",
        title: "Eval con ENOENT",
        questionStems: [doc(p(t("Pregunta")))],
        questionImages: [image("/api/uploads/evaluations/inst-A/ghost.png", 50)],
      }),
    );
    // No añadimos el archivo al fake → readUpload devolverá null
    readUpload.set("evaluations/inst-A/ghost.png", null);

    const res = await useCase.execute({
      actor: makeActor(["ECU_MASTER"]),
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { binaryFiles, textFiles } = await extractZip(res.value.zipBuffer);
    expect(binaryFiles.has("images/img-1.png")).toBe(false);
    const eval1 = textFiles.get("eval-1.tex") ?? "";
    expect(eval1).toContain("origen no resuelto");
  });

  // -------------------------------------------------------------------------
  // Math
  // -------------------------------------------------------------------------

  it("inlineMath y blockMath renderizan $..$ y \\[..\\]", async () => {
    const { useCase, evalRepo } = setup([
      { id: "b1", items: [{ id: "i1", evaluationId: "e1", order: 1 }] },
    ]);

    const detail = makeEvaluation({
      id: "e1",
      title: "Eval math",
      questionStems: [doc(p(t("Si "), inlineMath("x^2"), t(" = 4, ¿cuánto vale x?")))],
      questionImages: [null],
    });
    // Override section.content para incluir blockMath como bloque (no inline —
    // blockMath tiene group:'block' en TipTap, debe ir como sibling de paragraph).
    detail.sections[0]!.content = doc(
      p(t("Calcular: ")),
      blockMath("\\sum_{i=1}^{n} i"),
      p(t(".")),
    );
    evalRepo.set("e1", detail);

    const res = await useCase.execute({
      actor: makeActor(["ECU_MASTER"]),
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { textFiles } = await extractZip(res.value.zipBuffer);
    const eval1 = textFiles.get("eval-1.tex") ?? "";
    expect(eval1).toContain("$x^2$");
    expect(eval1).toContain("\\[\\sum_{i=1}^{n} i\\]");
  });

  // -------------------------------------------------------------------------
  // main.tex wiring
  // -------------------------------------------------------------------------

  it("main.tex contiene \\input{} por cada evaluation en orden", async () => {
    const { useCase, evalRepo } = setup([
      {
        id: "b1",
        items: [
          { id: "i1", evaluationId: "e1", order: 1 },
          { id: "i2", evaluationId: "e2", order: 2 },
        ],
      },
    ]);
    evalRepo.set("e1", makeEvaluation({ id: "e1", questionStems: [doc(p(t("Q")))] }));
    evalRepo.set("e2", makeEvaluation({ id: "e2", questionStems: [doc(p(t("Q")))] }));

    const res = await useCase.execute({
      actor: makeActor(["ECU_MASTER"]),
      mode: "bundle",
      targetId: "b1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { textFiles } = await extractZip(res.value.zipBuffer);
    const main = textFiles.get("main.tex") ?? "";
    const idx1 = main.indexOf("\\input{eval-1.tex}");
    const idx2 = main.indexOf("\\input{eval-2.tex}");
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(-1);
    expect(idx1).toBeLessThan(idx2);
  });
});
