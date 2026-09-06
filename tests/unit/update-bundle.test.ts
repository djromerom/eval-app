/**
 * Tests del use case `UpdateBundle` — Sprint 9 añade la edición del curso
 * del compendio, con la regla de que los items ya presentes deben ser
 * homogéneos con el curso que se asigna. Ver docs/compendios.md.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { UpdateBundle } from "@/modules/bundles/application/update-bundle";
import { MarkBundleReady } from "@/modules/bundles/application/mark-bundle-ready";
import {
  InMemoryBundleRepository,
  courses,
  periods,
  bookletTypes,
  seedEvaluationGrado6,
  superAdmin,
  teacher,
  years,
} from "./bundles-shared";

describe("UpdateBundle", () => {
  let repo: InMemoryBundleRepository;
  let createBundle: CreateBundle;
  let updateBundle: UpdateBundle;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    createBundle = new CreateBundle(repo, courses, years, periods, bookletTypes);
    updateBundle = new UpdateBundle(repo, courses, periods, bookletTypes);
  });

  /** Crea un bundle DRAFT con las evaluations dadas y devuelve su id. */
  async function draftBundleWith(
    evaluationIds: string[],
    courseId?: string | null,
  ): Promise<string> {
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Compendio de prueba", evaluationIds, courseId },
    });
    if (!created.ok) throw new Error(`setup: ${created.error.message}`);
    return created.value.id;
  }

  it("renombra un bundle en DRAFT", async () => {
    const ev = seedEvaluationGrado6(repo);
    const id = await draftBundleWith([ev.id]);
    const result = await updateBundle.execute({
      actor: superAdmin,
      bundleId: id,
      data: { name: "Nombre nuevo" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Nombre nuevo");
  });

  it("rechaza a un actor sin rol ECU_MASTER", async () => {
    const ev = seedEvaluationGrado6(repo);
    const id = await draftBundleWith([ev.id]);
    const result = await updateBundle.execute({
      actor: teacher,
      bundleId: id,
      data: { name: "Hackeado" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rechaza editar un bundle sellado (READY)", async () => {
    const ev = seedEvaluationGrado6(repo);
    const id = await draftBundleWith([ev.id]);
    const ready = await new MarkBundleReady(repo).execute({ actor: superAdmin, bundleId: id });
    if (!ready.ok) throw new Error("setup");

    const result = await updateBundle.execute({
      actor: superAdmin,
      bundleId: id,
      data: { name: "Nombre nuevo" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  // Sprint 9 — asignación de curso al compendio.
  describe("courseId (Sprint 9)", () => {
    it("asigna curso a un compendio cuyos items ya son de ese curso", async () => {
      const ev = seedEvaluationGrado6(repo, { courseId: "course-11" });
      const id = await draftBundleWith([ev.id]); // nace cross-course

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: id,
        data: { courseId: "course-11" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.courseId).toBe("course-11");
        expect(result.value.courseName).toBe("11°");
      }
    });

    it("rechaza asignar un curso si algún item es de otro curso", async () => {
      const ev6 = seedEvaluationGrado6(repo, {
        id: "ev-6",
        courseId: "course-6",
        title: "Biología 6°",
      });
      const ev11 = seedEvaluationGrado6(repo, { id: "ev-11", courseId: "course-11" });
      const id = await draftBundleWith([ev11.id, ev6.id]); // mezcla de grados

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: id,
        data: { courseId: "course-11" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        // El mensaje nombra el item conflictivo para que el admin sepa cuál quitar.
        expect(result.error.message).toContain("Biología 6°");
        expect(result.error.message).toContain("Quítalos primero");
      }
    });

    it("rechaza un curso que no existe en la institución", async () => {
      const ev = seedEvaluationGrado6(repo);
      const id = await draftBundleWith([ev.id]);
      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: id,
        data: { courseId: "course-fantasma" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("limpiar el curso (null) siempre se permite, aunque haya items mezclados", async () => {
      const ev11 = seedEvaluationGrado6(repo, { id: "ev-11", courseId: "course-11" });
      const id = await draftBundleWith([ev11.id], "course-11");

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: id,
        data: { courseId: null },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.courseId).toBeNull();
        expect(result.value.courseName).toBeNull();
      }
    });

    it("no toca el curso si `courseId` viene undefined", async () => {
      const ev = seedEvaluationGrado6(repo, { courseId: "course-11" });
      const id = await draftBundleWith([ev.id], "course-11");

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: id,
        data: { name: "Solo cambio el nombre" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.courseId).toBe("course-11");
    });
  });
});
