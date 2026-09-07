/**
 * Tests del campo `evaluationDate` en el Bundle (cuadernillo) — sep 2026.
 * =========================================================================
 *
 * El docente quiere recolectar la fecha de aplicación de la prueba a nivel
 * del cuadernillo para que aparezca preimpresa en la hoja de respuestas
 * unificada del bundle. Si el cuadernillo no tiene fecha, el bloque
 * "Fecha:" no se renderiza en absoluto (ni siquiera la línea vacía).
 *
 * Cubrimos:
 *   • CreateBundle la persiste cuando viene `Date`.
 *   • CreateBundle la deja en null cuando se omite.
 *   • UpdateBundle la asigna (null → Date).
 *   • UpdateBundle la limpia (Date → null) sin tocar otros campos.
 *   • UpdateBundle ignora `undefined` (no toca el campo).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import { UpdateBundle } from "@/modules/bundles/application/update-bundle";
import {
  InMemoryBundleRepository,
  bookletTypes,
  courses,
  periods,
  seedEvaluationGrado6,
  superAdmin,
  years,
} from "./bundles-shared";

describe("Bundle.evaluationDate (sep 2026)", () => {
  let repo: InMemoryBundleRepository;
  let createBundle: CreateBundle;
  let updateBundle: UpdateBundle;

  beforeEach(() => {
    repo = new InMemoryBundleRepository();
    createBundle = new CreateBundle(repo, courses, years, periods, bookletTypes);
    updateBundle = new UpdateBundle(repo, courses, periods, bookletTypes);
  });

  // ---------------------------------------------------------------------------
  // CreateBundle
  // ---------------------------------------------------------------------------

  describe("CreateBundle", () => {
    it("persiste evaluationDate cuando viene una fecha", async () => {
      const ev = seedEvaluationGrado6(repo);
      const date = new Date("2026-03-12T00:00:00.000Z");

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Cuadernillo Marzo",
          evaluationIds: [ev.id],
          evaluationDate: date,
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.evaluationDate?.toISOString()).toBe(date.toISOString());
    });

    it("deja evaluationDate en null cuando se omite", async () => {
      const ev = seedEvaluationGrado6(repo);

      const result = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Cuadernillo sin fecha", evaluationIds: [ev.id] },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.evaluationDate).toBeNull();
    });

    it("acepta evaluationDate: null explícito y lo persiste como null", async () => {
      const ev = seedEvaluationGrado6(repo);

      const result = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Cuadernillo explícito null",
          evaluationIds: [ev.id],
          evaluationDate: null,
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.evaluationDate).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // UpdateBundle
  // ---------------------------------------------------------------------------

  describe("UpdateBundle", () => {
    /** Crea un bundle DRAFT con 1 evaluation y sin fecha. Devuelve id. */
    async function draftWithoutDate(): Promise<string> {
      const ev = seedEvaluationGrado6(repo);
      const created = await createBundle.execute({
        actor: superAdmin,
        data: { name: "Compendio sin fecha", evaluationIds: [ev.id] },
      });
      if (!created.ok) throw new Error(`setup: ${created.error.message}`);
      return created.value.id;
    }

    it("asigna evaluationDate a un bundle que no la tenía", async () => {
      const id = await draftWithoutDate();
      const date = new Date("2026-04-20T00:00:00.000Z");

      const result = await updateBundle.execute({
        actor: superAdmin,
        bundleId: id,
        data: { evaluationDate: date },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.evaluationDate?.toISOString()).toBe(date.toISOString());
    });

    it("limpia evaluationDate cuando viene null", async () => {
      // Crear con fecha y luego limpiarla.
      const ev = seedEvaluationGrado6(repo);
      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Cuadernillo con fecha",
          evaluationIds: [ev.id],
          evaluationDate: new Date("2026-05-01T00:00:00.000Z"),
        },
      });
      if (!created.ok) throw new Error("setup");
      expect(created.value.evaluationDate).not.toBeNull();

      const cleared = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { evaluationDate: null },
      });

      expect(cleared.ok).toBe(true);
      if (!cleared.ok) return;
      expect(cleared.value.evaluationDate).toBeNull();
    });

    it("no toca evaluationDate cuando viene undefined", async () => {
      // Crear con fecha para que el test demuestre que un update SIN fecha
      // la respeta intacta (semántica undefined = no tocar).
      const ev = seedEvaluationGrado6(repo);
      const date = new Date("2026-06-15T00:00:00.000Z");
      const created = await createBundle.execute({
        actor: superAdmin,
        data: {
          name: "Cuadernillo con fecha",
          evaluationIds: [ev.id],
          evaluationDate: date,
        },
      });
      if (!created.ok) throw new Error("setup");

      const untouched = await updateBundle.execute({
        actor: superAdmin,
        bundleId: created.value.id,
        data: { name: "Solo cambio el nombre" },
      });

      expect(untouched.ok).toBe(true);
      if (!untouched.ok) return;
      expect(untouched.value.name).toBe("Solo cambio el nombre");
      expect(untouched.value.evaluationDate?.toISOString()).toBe(date.toISOString());
    });
  });
});
