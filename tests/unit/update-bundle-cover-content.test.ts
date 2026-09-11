/**
 * Tests del use case `UpdateBundleCoverContent` (PR 3, ago 2026).
 * ===============================================================
 *
 * Espejo de `tests/unit/update-bundle-theme.test.ts`. Validamos:
 *
 *   • Permisos: solo `ECU_MASTER` y `ECU_LIDER` pueden editar el copy de
 *     portada del compendio (igual que el theme — es contenido imprimible
 *     multi-tenant).
 *   • Lock por status: un compendio READY (sello verde) no puede cambiar
 *     el coverContent. Debe desmarcarse primero a DRAFT (misma regla que
 *     `UpdateBundleTheme`).
 *   • Aislamiento multi-tenant: un admin de otra institución no puede
 *     modificar el coverContent de un compendio ajeno.
 *   • Reset con `null`: limpia el override y deja `coverContent = null`,
 *     que en runtime hace que `getResolvedCoverContent()` colapse al
 *     `Institution.coverContent` (espejo del comportamiento de `null`
 *     en theme).
 *   • Defensa: el parser `parseCoverContent()` se aplica en el use case
 *     también en el write path — si llega un objeto con un campo que
 *     excede maxLength, ese campo se descarta (no rompe la request).
 */
import { describe, it, expect } from "vitest";
import { UpdateBundleCoverContent } from "@/modules/bundle-cover/application/update-bundle-cover-content";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import {
  InMemoryBundleRepository,
  superAdmin,
  teacher,
  seedEvaluationGrado6,
  courses,
  years,
  periods,
  bookletTypes,
} from "./bundles-shared";

async function makeRepoWithDraftBundle() {
  const repo = new InMemoryBundleRepository();
  const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
  const ev2 = seedEvaluationGrado6(repo, { id: "ev-2" });
  const create = new CreateBundle(repo, courses, years, periods, bookletTypes);
  const r = await create.execute({
    actor: superAdmin,
    data: { name: "Simulacro ICFES", evaluationIds: [ev1.id, ev2.id] },
  });
  if (!r.ok) throw new Error(`Setup falló: ${r.error.message}`);
  return { repo, bundleId: r.value.id };
}

describe("UpdateBundleCoverContent · permisos", () => {
  it("TEACHER no puede cambiar el contenido de portada", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: teacher,
      bundleId,
      coverContent: { calloutText: "X" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("ECU_MASTER puede cambiar el contenido de portada en DRAFT", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId,
      coverContent: {
        calloutText: "Marque con lápiz negro",
        itemsBefore: ["Lea cada pregunta", "No use corrector"],
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.coverContent).toEqual({
        calloutText: "Marque con lápiz negro",
        itemsBefore: ["Lea cada pregunta", "No use corrector"],
      });
    }
  });
});

describe("UpdateBundleCoverContent · invariantes de status", () => {
  it("rechaza cambio de contenido en compendio READY (inmutable)", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    await repo.setStatus(superAdmin.institutionId, bundleId, "READY");
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId,
      coverContent: { calloutText: "Intento en READY" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza cambio si el compendio es de otra institución", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: { ...superAdmin, institutionId: "inst-otra" },
      bundleId,
      coverContent: { calloutText: "Cross-tenant" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza cambio si el compendio no existe", async () => {
    const repo = new InMemoryBundleRepository();
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId: "no-existe",
      coverContent: { calloutText: "X" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("UpdateBundleCoverContent · reset al institucional", () => {
  it("null limpia el override y deja coverContent = null", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleCoverContent(repo);
    await uc.execute({
      actor: superAdmin,
      bundleId,
      coverContent: { calloutText: "Override inicial" },
    });
    const r = await uc.execute({ actor: superAdmin, bundleId, coverContent: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.coverContent).toBeNull();
  });
});

describe("UpdateBundleCoverContent · defensa en profundidad (parseCoverContent)", () => {
  it("descarta campo por campo si el objeto tiene campos inválidos", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId,
      coverContent: {
        calloutText: "OK",
        legalFooter: "x".repeat(301), // excede maxLength=300
        instructionsTitle: 42, // tipo incorrecto
        prohibitedBody: "válido",
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.coverContent).toEqual({
        calloutText: "OK",
        prohibitedBody: "válido",
      });
    }
  });

  it("trata tipo absurdo (string, number, array) como null", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleCoverContent(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId,
      coverContent: "no soy objeto",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.coverContent).toBeNull();
  });
});
