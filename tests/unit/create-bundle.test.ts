import { beforeEach, describe, expect, it } from "vitest";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import {
  InMemoryBundleRepository,
  seedEvaluationGrado6,
  superAdmin,
  teacher,
  adminOtherInstitution,
  courses,
  years,
  periods,
  bookletTypes,
} from "./bundles-shared";

describe("CreateBundle", () => {
  let repo: InMemoryBundleRepository;
  let useCase: CreateBundle;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    useCase = new CreateBundle(repo, courses, years, periods, bookletTypes);
  });

  it("crea el bundle con 1 evaluation (caso N=1, camino canónico)", async () => {
    const ev = seedEvaluationGrado6(repo);
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Biología 6° Periodo I", evaluationIds: [ev.id] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("DRAFT");
      expect(result.value.institutionId).toBe("inst-1");
      expect(result.value.bookletNumber).toBeNull();
    }
  });

  it("crea bundle con N=3 evaluaciones (caso multi-evaluación)", async () => {
    const bio = seedEvaluationGrado6(repo, {
      id: "ev-bio",
      subjectName: "Biología",
      totalQuestions: 33,
    });
    const fis = seedEvaluationGrado6(repo, {
      id: "ev-fis",
      subjectName: "Física",
      totalQuestions: 11,
    });
    const qui = seedEvaluationGrado6(repo, {
      id: "ev-qui",
      subjectName: "Química",
      totalQuestions: 11,
    });
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "C1 6° Periodo I", evaluationIds: [bio.id, fis.id, qui.id] },
    });
    expect(result.ok).toBe(true);
  });

  it("rechaza a TEACHER (solo SUPER_ADMIN)", async () => {
    const ev = seedEvaluationGrado6(repo);
    const result = await useCase.execute({
      actor: teacher,
      data: { name: "Bio", evaluationIds: [ev.id] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rechaza nombre con menos de 3 caracteres", async () => {
    const ev = seedEvaluationGrado6(repo);
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "ab", evaluationIds: [ev.id] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza evaluationIds vacío", async () => {
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza evaluationIds con duplicados", async () => {
    const ev = seedEvaluationGrado6(repo);
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id, ev.id] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza evaluación que no existe", async () => {
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: ["ghost-id"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza evaluación de otra institución", async () => {
    const ev = seedEvaluationGrado6(repo, { institutionId: "inst-2" });
    const result = await useCase.execute({
      actor: superAdmin, // inst-1
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza evaluación en estado DRAFT (no APPROVED ni PUBLISHED)", async () => {
    const ev = seedEvaluationGrado6(repo, { status: "DRAFT" });
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza bookletNumber negativo", async () => {
    const ev = seedEvaluationGrado6(repo);
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id], bookletNumber: -1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza bookletNumber duplicado en la misma institución", async () => {
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, { id: "ev-2" });
    await useCase.execute({
      actor: superAdmin,
      data: { name: "Bundle 1", evaluationIds: [ev1.id], bookletNumber: 1 },
    });
    const result = await useCase.execute({
      actor: superAdmin,
      data: { name: "Bundle 2", evaluationIds: [ev2.id], bookletNumber: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
  });

  it("actor de otra institución no ve bundles de inst-1", async () => {
    const ev = seedEvaluationGrado6(repo);
    await useCase.execute({
      actor: superAdmin,
      data: { name: "Bundle inst-1", evaluationIds: [ev.id] },
    });
    const ev2 = seedEvaluationGrado6(repo, { institutionId: "inst-2", id: "ev-otro" });
    const result = await useCase.execute({
      actor: adminOtherInstitution,
      data: { name: "Bundle inst-2", evaluationIds: [ev2.id] },
    });
    expect(result.ok).toBe(true);
    const all = await repo.findAll("inst-1");
    expect(all).toHaveLength(1);
  });

  // Sprint 9 — curso opcional del compendio.
  describe("courseId (Sprint 9)", () => {
    it("sin courseId el compendio es cross-course y admite grados mezclados", async () => {
      const bio6 = seedEvaluationGrado6(repo, { id: "ev-6", courseId: "course-6" });
      const fis11 = seedEvaluationGrado6(repo, {
        id: "ev-11",
        courseId: "course-11",
        subjectName: "Física",
      });
      const result = await useCase.execute({
        actor: superAdmin,
        data: { name: "Simulacro institucional", evaluationIds: [bio6.id, fis11.id] },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.courseId).toBeNull();
        expect(result.value.courseName).toBeNull();
      }
    });

    it("con courseId acepta evaluaciones de ese curso y lo persiste", async () => {
      const ev = seedEvaluationGrado6(repo, { courseId: "course-11" });
      const result = await useCase.execute({
        actor: superAdmin,
        data: { name: "Compendio 11°", evaluationIds: [ev.id], courseId: "course-11" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.courseId).toBe("course-11");
        expect(result.value.courseName).toBe("11°");
      }
    });

    it("rechaza una evaluación de otro curso cuando el compendio tiene curso", async () => {
      const ev = seedEvaluationGrado6(repo, { courseId: "course-6", title: "Biología 6°" });
      const result = await useCase.execute({
        actor: superAdmin,
        data: { name: "Compendio 11°", evaluationIds: [ev.id], courseId: "course-11" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Biología 6°");
      }
    });

    it("rechaza un curso que no existe en la institución del actor", async () => {
      const ev = seedEvaluationGrado6(repo);
      const result = await useCase.execute({
        actor: superAdmin,
        data: { name: "Compendio", evaluationIds: [ev.id], courseId: "course-fantasma" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("rechaza un curso de OTRA institución (aislamiento multi-tenant)", async () => {
      const ev = seedEvaluationGrado6(repo);
      const result = await useCase.execute({
        actor: superAdmin, // inst-1
        data: { name: "Compendio", evaluationIds: [ev.id], courseId: "course-otra" }, // inst-2
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });
  });
});
