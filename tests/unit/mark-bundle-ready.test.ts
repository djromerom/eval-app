import { beforeEach, describe, expect, it } from "vitest";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { MarkBundleReady } from "@/modules/bundles/application/mark-bundle-ready";
import {
  InMemoryBundleRepository,
  seedEvaluationGrado6,
  superAdmin,
  teacher,
  courses,
  years,
  periods,
  bookletTypes,
} from "./bundles-shared";

describe("MarkBundleReady", () => {
  let repo: InMemoryBundleRepository;
  let createBundle: CreateBundle;
  let markReady: MarkBundleReady;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    createBundle = new CreateBundle(repo, courses, years, periods, bookletTypes);
    markReady = new MarkBundleReady(repo);
  });

  it("marca READY un bundle con 1 evaluation válida", async () => {
    const ev = seedEvaluationGrado6(repo);
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await markReady.execute({ actor: superAdmin, bundleId: created.value.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("READY");
  });

  it("rechaza a TEACHER (solo SUPER_ADMIN)", async () => {
    const ev = seedEvaluationGrado6(repo);
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await markReady.execute({ actor: teacher, bundleId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rechaza si la evaluation volvió a DRAFT (dejó de ser printable)", async () => {
    const ev = seedEvaluationGrado6(repo);
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    if (!created.ok) throw new Error("setup");

    // Simulamos: la evaluation volvió a DRAFT por edición.
    repo.evaluations.get(ev.id)!.status = "DRAFT";

    const result = await markReady.execute({ actor: superAdmin, bundleId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza si la evaluation tiene 0 questions", async () => {
    const ev = seedEvaluationGrado6(repo, { totalQuestions: 0 });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    if (!created.ok) throw new Error("setup");

    const result = await markReady.execute({ actor: superAdmin, bundleId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza si el bundle ya está READY (no transición válida)", async () => {
    const ev = seedEvaluationGrado6(repo);
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Test", evaluationIds: [ev.id] },
    });
    if (!created.ok) throw new Error("setup");

    await markReady.execute({ actor: superAdmin, bundleId: created.value.id });
    const result = await markReady.execute({ actor: superAdmin, bundleId: created.value.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza si el bundle no existe", async () => {
    const result = await markReady.execute({ actor: superAdmin, bundleId: "ghost" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
