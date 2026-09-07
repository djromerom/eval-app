import { beforeEach, describe, expect, it } from "vitest";
import { AddEvaluationToBundle } from "@/modules/bundles/application/add-evaluation-to-bundle";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { MarkBundleReady } from "@/modules/bundles/application/mark-bundle-ready";
import { RemoveFromBundle } from "@/modules/bundles/application/remove-from-bundle";
import {
  InMemoryBundleRepository,
  courses,
  years,
  periods,
  bookletTypes,
  seedEvaluationGrado6,
  superAdmin,
} from "./bundles-shared";

describe("AddEvaluationToBundle", () => {
  let repo: InMemoryBundleRepository;
  let createBundle: CreateBundle;
  let addEvaluation: AddEvaluationToBundle;
  let markReady: MarkBundleReady;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    createBundle = new CreateBundle(repo, courses, years, periods, bookletTypes);
    addEvaluation = new AddEvaluationToBundle(repo);
    markReady = new MarkBundleReady(repo);
  });

  it("añade una segunda evaluation al bundle existente", async () => {
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, {
      id: "ev-2",
      subjectName: "Física",
      totalQuestions: 11,
    });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev1.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev2.id },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.order).toBe(2);

    const detail = await repo.findDetail("inst-1", created.value.id);
    expect(detail?.items).toHaveLength(2);
    expect(detail?.totalQuestions).toBe(44); // 33 + 11
  });

  it("rechaza añadir evaluation que ya está en el bundle", async () => {
    const ev = seedEvaluationGrado6(repo);
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev.id },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
  });

  it("rechaza añadir evaluation no APPROVED/PUBLISHED", async () => {
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, { id: "ev-2", status: "DRAFT" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev1.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev2.id },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza añadir si el bundle está en READY (sellado)", async () => {
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, { id: "ev-2" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev1.id] },
    });
    if (!created.ok) throw new Error("setup");
    await markReady.execute({ actor: superAdmin, bundleId: created.value.id });

    const result = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev2.id },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza añadir evaluation que no existe", async () => {
    const ev = seedEvaluationGrado6(repo);
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: "ghost" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("rechaza añadir evaluation de otra institución (no se filtra por tenant)", async () => {
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, { id: "ev-2", institutionId: "inst-2" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev1.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev2.id },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  // ====== Regresión: Unique constraint (bundleId, order) ======

  it("regresión: append tras eliminar item intermedio NO choca con @@unique([bundleId, order])", async () => {
    // Escenario del bug 2026-07-19:
    //   - Bundle con 3 items [order=1, order=2, order=3]
    //   - Usuario elimina el item de order=2 → quedan [order=1, order=3] (gap en 2)
    //   - Usuario añade otra evaluación (append) → antes calculaba
    //     count+1 = 3 (correcto), pero al añadir OTRO después calculaba
    //     count+1 = 3 de nuevo → colisión con el item en order=3.
    // Fix: usar max(order)+1, no count+1. Ver InMemoryBundleRepository.addItem
    // y PrismaBundleRepository.addItem.
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, { id: "ev-2" });
    const ev3 = seedEvaluationGrado6(repo, { id: "ev-3" });
    const ev4 = seedEvaluationGrado6(repo, { id: "ev-4" });
    const ev5 = seedEvaluationGrado6(repo, { id: "ev-5" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev1.id, ev2.id, ev3.id] },
    });
    if (!created.ok) throw new Error("setup");

    // Quitar el item intermedio (order=2).
    const itemsAfterCreate = await repo.listItemsOrdered(created.value.id);
    const middleItem = itemsAfterCreate.find((i) => i.order === 2)!;
    const remove = new RemoveFromBundle(repo);
    const r1 = await remove.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemId: middleItem.id,
    });
    expect(r1.ok).toBe(true);

    // Primera adición: debe caer en order=4 (max=3, next=4).
    // Después del remove quedan items en order=[1, 3]. max=3, next=4. OK.
    const a1 = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev4.id },
    });
    expect(a1.ok).toBe(true);
    if (a1.ok) expect(a1.value.order).toBe(4);

    // Segunda adición: items en [1, 3, 4]. max=4, next=5. Sin colisión.
    const a2 = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev5.id },
    });
    expect(a2.ok).toBe(true);
    if (a2.ok) expect(a2.value.order).toBe(5);

    const finalItems = await repo.listItemsOrdered(created.value.id);
    expect(finalItems.map((i) => i.order).sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
  });

  it("regresión: append cuando hay gap (orders no contiguos) funciona", async () => {
    // Variante más simple: items en [1, 3] (eliminado el 2) y append → next=4.
    const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
    const ev2 = seedEvaluationGrado6(repo, { id: "ev-2" });
    const ev3 = seedEvaluationGrado6(repo, { id: "ev-3" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [ev1.id, ev2.id] },
    });
    if (!created.ok) throw new Error("setup");

    const items = await repo.listItemsOrdered(created.value.id);
    const item1 = items.find((i) => i.order === 1)!;
    const remove = new RemoveFromBundle(repo);
    await remove.execute({ actor: superAdmin, bundleId: created.value.id, itemId: item1.id });

    // Tras eliminar el order=1 quedan [order=2]. count+1 sería 2 → colisión.
    // Con max+1 = 3 → libre.
    const a = await addEvaluation.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      data: { evaluationId: ev3.id },
    });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.order).toBe(3);
  });

  // Sprint 9 — el curso del compendio restringe qué evaluations admite.
  describe("courseId (Sprint 9)", () => {
    it("añade una evaluación del mismo curso que el compendio", async () => {
      const ev1 = seedEvaluationGrado6(repo, { id: "ev-1", courseId: "course-11" });
      const ev2 = seedEvaluationGrado6(repo, {
        id: "ev-2",
        courseId: "course-11",
        subjectName: "Física",
      });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio 11°", evaluationIds: [ev1.id], courseId: "course-11" },
      });
      if (!created.ok) throw new Error("setup");

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev2.id },
      });
      expect(result.ok).toBe(true);
    });

    it("rechaza una evaluación de otro curso", async () => {
      const ev11 = seedEvaluationGrado6(repo, { id: "ev-11", courseId: "course-11" });
      const ev6 = seedEvaluationGrado6(repo, {
        id: "ev-6",
        courseId: "course-6",
        title: "Biología 6°",
      });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio 11°", evaluationIds: [ev11.id], courseId: "course-11" },
      });
      if (!created.ok) throw new Error("setup");

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev6.id },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("11°");
      }
    });

    it("un compendio cross-course (sin curso) admite cualquier grado", async () => {
      const ev11 = seedEvaluationGrado6(repo, { id: "ev-11", courseId: "course-11" });
      const ev6 = seedEvaluationGrado6(repo, { id: "ev-6", courseId: "course-6" });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Simulacro institucional", evaluationIds: [ev11.id] },
      });
      if (!created.ok) throw new Error("setup");

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev6.id },
      });
      expect(result.ok).toBe(true);
    });
  });
});
