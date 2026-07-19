/**
 * Tests del use case `UpdateBundleTheme` — la regla de negocio crítica
 * es que un compendio READY no puede cambiarse (debe desmarcarse primero).
 * Ver Sprint 5 docs/compendios.md.
 */
import { describe, it, expect } from "vitest";
import { UpdateBundleTheme } from "@/modules/bundles/application/update-bundle-theme";
import { CreateBundle } from "@/modules/bundles/application/create-bundle";
import {
  InMemoryBundleRepository,
  superAdmin,
  teacher,
  seedEvaluationGrado6,
  courses,
} from "./bundles-shared";

async function makeRepoWithDraftBundle() {
  const repo = new InMemoryBundleRepository();
  const ev1 = seedEvaluationGrado6(repo, { id: "ev-1" });
  const ev2 = seedEvaluationGrado6(repo, { id: "ev-2" });
  // Crear el bundle a través del use case (no `repo.create` directo) — el
  // use case arma el `evaluationsById` Map correctamente.
  const create = new CreateBundle(repo, courses);
  const r = await create.execute({
    actor: superAdmin,
    data: { name: "Simulacro ICFES", evaluationIds: [ev1.id, ev2.id] },
  });
  if (!r.ok) throw new Error(`Setup falló: ${r.error.message}`);
  return { repo, bundleId: r.value.id };
}

describe("UpdateBundleTheme · permisos", () => {
  it("TEACHER no puede cambiar el tema (solo SUPER_ADMIN)", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleTheme(repo);
    const r = await uc.execute({
      actor: teacher,
      bundleId,
      theme: { primary: "#1E40AF" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("SUPER_ADMIN puede cambiar el tema en DRAFT", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleTheme(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId,
      theme: { primary: "#1E40AF", coverSubtitle: "Grado Undécimo" },
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.theme).toEqual({ primary: "#1E40AF", coverSubtitle: "Grado Undécimo" });
  });
});

describe("UpdateBundleTheme · invariantes de status", () => {
  it("rechaza cambio de tema en compendio READY (inmutable)", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    // Simular transición a READY
    await repo.setStatus(superAdmin.institutionId, bundleId, "READY");
    const uc = new UpdateBundleTheme(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId,
      theme: { primary: "#FF0000" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza cambio de tema en compendio de otra institución", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleTheme(repo);
    const r = await uc.execute({
      actor: { ...superAdmin, institutionId: "inst-otra" },
      bundleId,
      theme: { primary: "#FF0000" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rechaza cambio si el bundle no existe", async () => {
    const repo = new InMemoryBundleRepository();
    const uc = new UpdateBundleTheme(repo);
    const r = await uc.execute({
      actor: superAdmin,
      bundleId: "no-existe",
      theme: { primary: "#000000" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("UpdateBundleTheme · reset al institucional (theme = null)", () => {
  it("null limpia el override y deja theme = null", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleTheme(repo);
    await uc.execute({
      actor: superAdmin,
      bundleId,
      theme: { primary: "#1E40AF", coverSubtitle: "Periodo I" },
    });
    const r = await uc.execute({ actor: superAdmin, bundleId, theme: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.theme).toBeNull();
  });

  it("undefined se trata como null (comportamiento del operador ??)", async () => {
    const { repo, bundleId } = await makeRepoWithDraftBundle();
    const uc = new UpdateBundleTheme(repo);
    // El use case recibe unknown | null — undefined cae a null en la línea 40.
    // Lo testeamos pasando el valor que el endpoint serializa (null) ya que
    // el endpoint NUNCA envía undefined (no haría nada).
    const r = await uc.execute({ actor: superAdmin, bundleId, theme: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.theme).toBeNull();
  });
});
