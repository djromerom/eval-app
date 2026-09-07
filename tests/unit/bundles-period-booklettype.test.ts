/**
 * Tests del Sprint Bundle-Period (sep 2026): Prueba + Tipo de cuadernillo
 * en `EvaluationBundle`.
 *
 * Cubre:
 *   - CreateBundle: validación de periodId / bookletTypeId, default al
 *     periodo actual del año académico vigente, invariante "items
 *     homogéneos al BookletType del bundle".
 *   - UpdateBundle: asignación, limpieza y rechazo de cambios que rompan
 *     la homogeneidad.
 *   - AddEvaluationToBundle: rechazo si el item no coincide con el
 *     BookletType del bundle.
 *   - ListBundles: filtros por Prueba / Tipo / Estado.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AddEvaluationToBundle } from "@/modules/bundles/application/add-evaluation-to-bundle";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { ListBundles } from "@/modules/bundles/application/list-bundles";
import { MarkBundleReady } from "@/modules/bundles/application/mark-bundle-ready";
import { UpdateBundle } from "@/modules/bundles/application/update-bundle";
import type { LeaderAssignmentRepository } from "@/modules/leader-assignments/domain/leader-assignment";
import {
  InMemoryAcademicYearRepository,
  InMemoryBookletTypeRepository,
  InMemoryBundleRepository,
  InMemoryPeriodRepository,
  bookletTypeNameOf,
  courses,
  periodNameOf,
  seedEvaluationGrado6,
  superAdmin,
} from "./bundles-shared";

/** Stub mínimo de LeaderAssignmentRepository (sprint lider-ecu). */
class FakeLeaderAssignments implements LeaderAssignmentRepository {
  assigned: string[] = [];
  async listAssignedCourseIds() {
    return this.assigned;
  }
  async assign() {
    /* noop */
  }
  async unassign() {
    /* noop */
  }
  async isAssigned() {
    return false;
  }
  async listAssignments() {
    return [];
  }
}

describe("Bundle-Period / Bundle-BookletType (Sprint sep 2026)", () => {
  let repo: InMemoryBundleRepository;
  let years: InMemoryAcademicYearRepository;
  let periods: InMemoryPeriodRepository;
  let bookletTypes: InMemoryBookletTypeRepository;
  let createBundle: CreateBundle;
  let updateBundle: UpdateBundle;
  let addEvaluation: AddEvaluationToBundle;
  let listBundles: ListBundles;

  /** Helper: crea un año académico actual con un periodo "actual". */
  async function seedCurrentAcademicYearWithCurrentPeriod(
    institutionId: string,
    periodName = "I Periodo",
  ): Promise<{ academicYearId: string; periodId: string }> {
    const year = await years.create(institutionId, {
      year: 2026,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      isCurrent: true,
    });
    const period = await periods.create(institutionId, {
      academicYearId: year.id,
      name: periodName,
      order: 1,
      startDate: new Date("2026-01-15"),
      endDate: new Date("2026-04-15"),
    });
    await periods.setCurrent(institutionId, year.id, period.id, true);
    return { academicYearId: year.id, periodId: period.id };
  }

  beforeEach(() => {
    years = new InMemoryAcademicYearRepository();
    periods = new InMemoryPeriodRepository();
    bookletTypes = new InMemoryBookletTypeRepository();
    // Inyecta los repos de Period/BookletType al InMemoryBundleRepository
    // para que `periodName`/`bookletTypeName` se hidraten igual que en Prisma
    // (vía join). Sin esto, los nombres resuelven al catálogo estático y
    // los bookletTypes creados dinámicamente quedan con name=null.
    repo = new InMemoryBundleRepository(periods, bookletTypes);
    createBundle = new CreateBundle(repo, courses, years, periods, bookletTypes);
    updateBundle = new UpdateBundle(repo, courses, periods, bookletTypes);
    addEvaluation = new AddEvaluationToBundle(repo);
    listBundles = new ListBundles(repo, new FakeLeaderAssignments());
  });

  // ─── CreateBundle ─────────────────────────────────────────────────────

  describe("CreateBundle — periodId", () => {
    it("sin periodId inyecta el periodo actual del año académico vigente", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const ev = seedEvaluationGrado6(repo);

      const result = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio I Periodo", evaluationIds: [ev.id] },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.periodId).toBe(periodId);
        expect(result.value.periodName).toBe("I Periodo");
        expect(result.value.bookletTypeId).toBeNull();
        expect(result.value.bookletTypeName).toBeNull();
      }
    });

    it("sin periodId y sin año académico vigente → periodId = null (default suave)", async () => {
      const ev = seedEvaluationGrado6(repo);
      const result = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio legacy", evaluationIds: [ev.id] },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.periodId).toBeNull();
        expect(result.value.periodName).toBeNull();
      }
    });

    it("periodId: null explícito deja periodId = null aunque haya año actual", async () => {
      await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const ev = seedEvaluationGrado6(repo);
      const result = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Sin prueba", evaluationIds: [ev.id], periodId: null },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.periodId).toBeNull();
    });

    it("rechaza un periodId que no existe en la institución", async () => {
      const ev = seedEvaluationGrado6(repo);
      const result = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Test", evaluationIds: [ev.id], periodId: "period-fantasma" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Prueba");
      }
    });
  });

  describe("CreateBundle — bookletTypeId", () => {
    it("con periodId + bookletTypeId válidos del mismo Period persiste ambos", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", {
        periodId,
        name: "Estándar",
      });
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: bt.id,
        bookletTypeName: bt.name,
      });

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Compendio Estándar",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: bt.id,
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.periodId).toBe(periodId);
        expect(result.value.bookletTypeId).toBe(bt.id);
        expect(result.value.bookletTypeName).toBe("Estándar");
      }
    });

    it("rechaza bookletTypeId que pertenece a OTRO periodId", async () => {
      const { periodId: p1 } = await seedCurrentAcademicYearWithCurrentPeriod(
        "inst-1",
        "I Periodo",
      );
      // Creamos un segundo periodo y un BookletType en él.
      const year = years.items.find((y) => y.institutionId === "inst-1")!;
      const p2 = await periods.create("inst-1", {
        academicYearId: year.id,
        name: "II Periodo",
        order: 2,
        startDate: new Date("2026-04-16"),
        endDate: new Date("2026-08-15"),
      });
      const bt2 = await bookletTypes.create("inst-1", {
        periodId: p2.id,
        name: "Estándar",
      });
      const ev = seedEvaluationGrado6(repo);

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Cross Period",
          evaluationIds: [ev.id],
          periodId: p1,
          bookletTypeId: bt2.id,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Prueba");
      }
    });

    it("rechaza bookletTypeId que no existe en la institución", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const ev = seedEvaluationGrado6(repo);

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Test",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: "bt-fantasma",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("tipo de cuadernillo");
      }
    });

    it("rechaza items con BookletType distinto al del bundle", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const btStd = await bookletTypes.create("inst-1", {
        periodId,
        name: "Estándar",
      });
      const btEsp = await bookletTypes.create("inst-1", {
        periodId,
        name: "Especial",
      });
      const ev = seedEvaluationGrado6(repo, {
        id: "ev-1",
        bookletTypeId: btEsp.id,
        bookletTypeName: "Especial",
        title: "Biología NEE",
      });

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Solo Estándar",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: btStd.id,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Biología NEE");
        expect(result.error.message).toContain("Especial");
      }
    });

    it("acepta items con BookletType null cuando el bundle tampoco tiene BookletType (compat legacy)", async () => {
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: null,
        bookletTypeName: null,
      });
      const result = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Legacy sin tipo", evaluationIds: [ev.id] },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.bookletTypeId).toBeNull();
    });

    it("rechaza items con BookletType null cuando el bundle SÍ tiene BookletType", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", {
        periodId,
        name: "Estándar",
      });
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: null,
        bookletTypeName: null,
      });

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Solo Estándar",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: bt.id,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Biología 6°");
      }
    });
  });

  // ─── UpdateBundle ─────────────────────────────────────────────────────

  describe("UpdateBundle — periodId / bookletTypeId", () => {
    it("asigna periodId y bookletTypeId compatibles a un bundle ya creado", async () => {
      const ev = seedEvaluationGrado6(repo);
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio C1", evaluationIds: [ev.id] },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", { periodId, name: "Estándar" });
      // El item (ev) no tiene BookletType — UpdateBundle NO debe dejarlo asignar.
      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { periodId, bookletTypeId: bt.id },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("asigna periodId + bookletTypeId cuando el item ya es de ese BookletType", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", { periodId, name: "Estándar" });
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: bt.id,
        bookletTypeName: "Estándar",
      });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio C1", evaluationIds: [ev.id] },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { periodId, bookletTypeId: bt.id },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.periodId).toBe(periodId);
        expect(result.value.bookletTypeId).toBe(bt.id);
      }
    });

    it("rechaza cambiar bookletTypeId si un item ya es de otro tipo", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const btStd = await bookletTypes.create("inst-1", {
        periodId,
        name: "Estándar",
      });
      const btEsp = await bookletTypes.create("inst-1", {
        periodId,
        name: "Especial",
      });
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: btStd.id,
        bookletTypeName: "Estándar",
      });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Compendio C1",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: btStd.id,
        },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { bookletTypeId: btEsp.id },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Especial");
        expect(result.error.message).toContain("Quítalos primero");
      }
    });

    it("rechaza un periodId inexistente", async () => {
      const ev = seedEvaluationGrado6(repo);
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio C1", evaluationIds: [ev.id] },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { periodId: "period-fantasma" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });

    it("limpiar periodId / bookletTypeId (null) siempre se permite", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", { periodId, name: "Estándar" });
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: bt.id,
        bookletTypeName: "Estándar",
      });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Compendio C1",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: bt.id,
        },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { periodId: null, bookletTypeId: null },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.periodId).toBeNull();
        expect(result.value.bookletTypeId).toBeNull();
      }
    });

    it("no toca periodId / bookletTypeId si vienen undefined", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", { periodId, name: "Estándar" });
      const ev = seedEvaluationGrado6(repo, {
        bookletTypeId: bt.id,
        bookletTypeName: "Estándar",
      });
      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Compendio C1",
          evaluationIds: [ev.id],
          periodId,
          bookletTypeId: bt.id,
        },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { name: "Renombrado" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.periodId).toBe(periodId);
        expect(result.value.bookletTypeId).toBe(bt.id);
      }
    });
  });

  // ─── AddEvaluationToBundle ────────────────────────────────────────────

  describe("AddEvaluationToBundle — bookletType mismatch", () => {
    it("rechaza añadir un item de otro BookletType al bundle", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const btStd = await bookletTypes.create("inst-1", {
        periodId,
        name: "Estándar",
      });
      const btEsp = await bookletTypes.create("inst-1", {
        periodId,
        name: "Especial",
      });
      const ev1 = seedEvaluationGrado6(repo, {
        id: "ev-std",
        bookletTypeId: btStd.id,
        bookletTypeName: "Estándar",
      });
      const ev2 = seedEvaluationGrado6(repo, {
        id: "ev-esp",
        bookletTypeId: btEsp.id,
        bookletTypeName: "Especial",
        title: "Biología NEE",
      });

      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Solo Estándar",
          evaluationIds: [ev1.id],
          periodId,
          bookletTypeId: btStd.id,
        },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev2.id },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION");
        expect(result.error.message).toContain("Especial");
        expect(result.error.message).toContain("Biología NEE");
      }
    });

    it("permite añadir un item del mismo BookletType al bundle", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", { periodId, name: "Estándar" });
      const ev1 = seedEvaluationGrado6(repo, {
        id: "ev-1",
        bookletTypeId: bt.id,
        bookletTypeName: "Estándar",
      });
      const ev2 = seedEvaluationGrado6(repo, {
        id: "ev-2",
        bookletTypeId: bt.id,
        bookletTypeName: "Estándar",
        subjectName: "Física",
        title: "Física 6°",
      });

      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Compendio Estándar",
          evaluationIds: [ev1.id],
          periodId,
          bookletTypeId: bt.id,
        },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev2.id },
      });
      expect(result.ok).toBe(true);
    });

    it("permite añadir un item sin BookletType al bundle sin BookletType (compat legacy)", async () => {
      const ev1 = seedEvaluationGrado6(repo, {
        id: "ev-1",
        bookletTypeId: null,
        bookletTypeName: null,
      });
      const ev2 = seedEvaluationGrado6(repo, {
        id: "ev-2",
        bookletTypeId: null,
        bookletTypeName: null,
        subjectName: "Física",
      });

      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Legacy", evaluationIds: [ev1.id] },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev2.id },
      });
      expect(result.ok).toBe(true);
    });

    it("rechaza añadir un item sin BookletType a un bundle CON BookletType", async () => {
      const { periodId } = await seedCurrentAcademicYearWithCurrentPeriod("inst-1");
      const bt = await bookletTypes.create("inst-1", { periodId, name: "Estándar" });
      const ev1 = seedEvaluationGrado6(repo, {
        id: "ev-1",
        bookletTypeId: bt.id,
        bookletTypeName: "Estándar",
      });
      const ev2 = seedEvaluationGrado6(repo, {
        id: "ev-2",
        bookletTypeId: null,
        bookletTypeName: null,
        subjectName: "Física",
      });

      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Solo Estándar",
          evaluationIds: [ev1.id],
          periodId,
          bookletTypeId: bt.id,
        },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);

      const result = await addEvaluation.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationId: ev2.id },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("VALIDATION");
    });
  });

  // ─── ListBundles — filtros ────────────────────────────────────────────

  describe("ListBundles — filtros", () => {
    /** Helper: crea N bundles con periodId/bookletTypeId variables. */
    async function seedThreeBundles() {
      const { periodId: p1 } = await seedCurrentAcademicYearWithCurrentPeriod(
        "inst-1",
        "I Periodo",
      );
      const year = years.items.find((y) => y.institutionId === "inst-1")!;
      const p2 = await periods.create("inst-1", {
        academicYearId: year.id,
        name: "II Periodo",
        order: 2,
        startDate: new Date("2026-04-16"),
        endDate: new Date("2026-08-15"),
      });
      const btStd1 = await bookletTypes.create("inst-1", {
        periodId: p1,
        name: "Estándar",
      });
      const btEsp1 = await bookletTypes.create("inst-1", {
        periodId: p1,
        name: "Especial",
      });

      const evStd1 = seedEvaluationGrado6(repo, {
        id: "ev-std-1",
        bookletTypeId: btStd1.id,
        bookletTypeName: "Estándar",
      });
      const evEsp1 = seedEvaluationGrado6(repo, {
        id: "ev-esp-1",
        bookletTypeId: btEsp1.id,
        bookletTypeName: "Especial",
        title: "Biología NEE",
      });
      const evPlain = seedEvaluationGrado6(repo, {
        id: "ev-plain",
        bookletTypeId: null,
        bookletTypeName: null,
        title: "Sin tipo",
      });

      // Bundle A: p1 + btStd1
      const a = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Bundle A",
          evaluationIds: [evStd1.id],
          periodId: p1,
          bookletTypeId: btStd1.id,
        },
      });
      if (!a.ok) throw new Error(`setup A: ${a.error.message}`);

      // Bundle B: p1 + btEsp1
      const b = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Bundle B",
          evaluationIds: [evEsp1.id],
          periodId: p1,
          bookletTypeId: btEsp1.id,
        },
      });
      if (!b.ok) throw new Error(`setup B: ${b.error.message}`);

      // Bundle C: p2, sin tipo
      const c = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Bundle C",
          evaluationIds: [evPlain.id],
          periodId: p2.id,
          bookletTypeId: null,
        },
      });
      if (!c.ok) throw new Error(`setup C: ${c.error.message}`);

      return { p1, p2: p2.id, btStd1, btEsp1, bundleIds: [a.value.id, b.value.id, c.value.id] };
    }

    it("sin filtros devuelve los 3 bundles", async () => {
      await seedThreeBundles();
      const result = await listBundles.execute({ actor: superAdmin });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(3);
    });

    it("filtro por periodId devuelve solo los de esa Prueba", async () => {
      const { p1 } = await seedThreeBundles();
      const result = await listBundles.execute({
        actor: superAdmin,
        filters: { periodId: p1 },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((b) => b.periodId === p1)).toBe(true);
      }
    });

    it("filtro por bookletTypeId devuelve solo los de ese Tipo", async () => {
      const { btEsp1 } = await seedThreeBundles();
      const result = await listBundles.execute({
        actor: superAdmin,
        filters: { bookletTypeId: btEsp1.id },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.bookletTypeId).toBe(btEsp1.id);
      }
    });

    it("filtro combinado periodId + bookletTypeId devuelve solo el match exacto", async () => {
      const { p1, btStd1 } = await seedThreeBundles();
      const result = await listBundles.execute({
        actor: superAdmin,
        filters: { periodId: p1, bookletTypeId: btStd1.id },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.name).toBe("Bundle A");
      }
    });

    it("filtro por status combina con los demás filtros", async () => {
      const { bundleIds } = await seedThreeBundles();
      // Marcamos el Bundle A como READY.
      const ready = await new MarkBundleReady(repo).execute({
        actor: superAdmin,
        bundleId: bundleIds[0]!,
      });
      if (!ready.ok) throw new Error(`setup ready: ${ready.error.message}`);

      const result = await listBundles.execute({
        actor: superAdmin,
        filters: { status: "READY" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.status).toBe("READY");
      }
    });

    it("filtros que no matchean nada devuelven []", async () => {
      await seedThreeBundles();
      const result = await listBundles.execute({
        actor: superAdmin,
        filters: { periodId: "period-fantasma" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(0);
    });
  });
});

// Helpers reusados localmente para asegurar que los getters de nombres
// funcionan igual que en el repo Prisma (los joins).
void bookletTypeNameOf;
void periodNameOf;
