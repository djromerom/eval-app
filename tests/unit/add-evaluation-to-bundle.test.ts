import { beforeEach, describe, expect, it } from "vitest";
import { AddEvaluationToBundle } from "@/modules/bundles/application/add-evaluation-to-bundle";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { MarkBundleReady } from "@/modules/bundles/application/mark-bundle-ready";
import { InMemoryBundleRepository, seedEvaluationGrado6, superAdmin } from "./bundles-shared";

describe("AddEvaluationToBundle", () => {
  let repo: InMemoryBundleRepository;
  let createBundle: CreateBundle;
  let addEvaluation: AddEvaluationToBundle;
  let markReady: MarkBundleReady;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    createBundle = new CreateBundle(repo);
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
});
