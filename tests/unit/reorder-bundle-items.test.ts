import { beforeEach, describe, expect, it } from "vitest";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { MarkBundleReady } from "@/modules/bundles/application/mark-bundle-ready";
import { ReorderBundleItems } from "@/modules/bundles/application/reorder-bundle-items";
import {
  InMemoryBundleRepository,
  courses,
  seedEvaluationGrado6,
  superAdmin,
} from "./bundles-shared";

describe("ReorderBundleItems", () => {
  let repo: InMemoryBundleRepository;
  let createBundle: CreateBundle;
  let reorder: ReorderBundleItems;
  let markReady: MarkBundleReady;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    createBundle = new CreateBundle(repo, courses);
    reorder = new ReorderBundleItems(repo);
    markReady = new MarkBundleReady(repo);
  });

  it("reordena los 3 items en orden inverso", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio", subjectName: "Biología" });
    const fis = seedEvaluationGrado6(repo, { id: "ev-fis", subjectName: "Física" });
    const qui = seedEvaluationGrado6(repo, { id: "ev-qui", subjectName: "Química" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [bio.id, fis.id, qui.id] },
    });
    if (!created.ok) throw new Error("setup");

    const items = await repo.listItemsOrdered(created.value.id);
    const [b, f, q] = items;
    const reversed = [q!.id, f!.id, b!.id];

    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemIds: reversed,
    });
    expect(result.ok).toBe(true);

    const reordered = await repo.listItemsOrdered(created.value.id);
    expect(reordered.map((i) => i.id)).toEqual(reversed);
    expect(reordered.map((i) => i.order)).toEqual([1, 2, 3]);
  });

  it("rechaza si la lista no tiene el mismo tamaño que los items actuales", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio" });
    const fis = seedEvaluationGrado6(repo, { id: "ev-fis" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [bio.id, fis.id] },
    });
    if (!created.ok) throw new Error("setup");

    const items = await repo.listItemsOrdered(created.value.id);
    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemIds: [items[0]!.id], // solo 1 de 2
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza si la lista tiene duplicados", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio" });
    const fis = seedEvaluationGrado6(repo, { id: "ev-fis" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C1 Bio", evaluationIds: [bio.id, fis.id] },
    });
    if (!created.ok) throw new Error("setup");

    const items = await repo.listItemsOrdered(created.value.id);
    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemIds: [items[0]!.id, items[0]!.id],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  it("rechaza si un item no pertenece al bundle", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio" });
    const fis = seedEvaluationGrado6(repo, { id: "ev-fis" });
    const qui = seedEvaluationGrado6(repo, { id: "ev-qui" });
    const b1 = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Bundle test", evaluationIds: [bio.id, fis.id] },
    });
    if (!b1.ok) throw new Error("setup");

    const itemsB1 = await repo.listItemsOrdered(b1.value.id);
    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: b1.value.id,
      itemIds: [itemsB1[0]!.id, "ghost-item-id"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
    void qui; // evita warning de unused
  });

  it("rechaza reordenar si el bundle está READY", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "Bundle test", evaluationIds: [bio.id] },
    });
    if (!created.ok) throw new Error("setup");
    await markReady.execute({ actor: superAdmin, bundleId: created.value.id });

    const items = await repo.listItemsOrdered(created.value.id);
    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemIds: [items[0]!.id],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });

  // Regresión Sprint 5: si reorderItems volviera a actualizar in-place,
  // el @@unique([bundleId, order]) del schema Prisma dispararía en Postgres
  // "Unique constraint failed on the fields: (bundleId, order)" al revertir
  // [1,2,3] → [3,2,1]. El InMemoryBundleRepository simula el constraint para
  // que un futuro cambio que revierta a in-place falle aquí también.
  it("reordena desplazando el primer item al final (regression de @@unique)", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio" });
    const fis = seedEvaluationGrado6(repo, { id: "ev-fis" });
    const qui = seedEvaluationGrado6(repo, { id: "ev-qui" });
    const mat = seedEvaluationGrado6(repo, { id: "ev-mat" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C shift-up", evaluationIds: [bio.id, fis.id, qui.id, mat.id] },
    });
    if (!created.ok) throw new Error("setup");

    const items = await repo.listItemsOrdered(created.value.id);
    // mover el primero al final → [b, f, q, m] → [f, q, m, b]
    const shifted = [items[1]!.id, items[2]!.id, items[3]!.id, items[0]!.id];
    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemIds: shifted,
    });
    expect(result.ok).toBe(true);

    const reordered = await repo.listItemsOrdered(created.value.id);
    expect(reordered.map((i) => i.id)).toEqual(shifted);
    expect(reordered.map((i) => i.order)).toEqual([1, 2, 3, 4]);
  });

  it("mantiene un no-op (mismo orden) sin chocar contra el unique constraint", async () => {
    const bio = seedEvaluationGrado6(repo, { id: "ev-bio" });
    const fis = seedEvaluationGrado6(repo, { id: "ev-fis" });
    const created = await createBundle.execute({
      actor: superAdmin,
      data: { name: "C no-op", evaluationIds: [bio.id, fis.id] },
    });
    if (!created.ok) throw new Error("setup");

    const items = await repo.listItemsOrdered(created.value.id);
    const result = await reorder.execute({
      actor: superAdmin,
      bundleId: created.value.id,
      itemIds: [items[0]!.id, items[1]!.id],
    });
    expect(result.ok).toBe(true);

    const after = await repo.listItemsOrdered(created.value.id);
    expect(after.map((i) => i.id)).toEqual([items[0]!.id, items[1]!.id]);
    expect(after.map((i) => i.order)).toEqual([1, 2]);
  });
});
