import { describe, expect, it } from "vitest";

import { ALL_PERIODS, resolvePeriodFilter } from "@/modules/academic/domain/period-filter";

/**
 * Filtro de prueba por defecto de los listados (nov 2026).
 *
 * El listado arranca en la PRUEBA ACTUAL (la marcada con `Period.isCurrent`).
 * Como el filtro vive en la URL, hay que distinguir "no vine con filtro"
 * (→ la prueba actual) de "quiero ver todas" (→ el centinela `all`).
 */
describe("resolvePeriodFilter", () => {
  it("sin filtro en la URL usa la prueba actual", () => {
    const r = resolvePeriodFilter("", "p-actual");
    expect(r).toEqual({ periodId: "p-actual", showAll: false });
  });

  it("'all' deja el filtro abierto (ver todas las pruebas)", () => {
    const r = resolvePeriodFilter(ALL_PERIODS, "p-actual");
    expect(r).toEqual({ periodId: null, showAll: true });
  });

  it("un id explícito manda sobre la prueba actual", () => {
    const r = resolvePeriodFilter("p-2025-2", "p-actual");
    expect(r).toEqual({ periodId: "p-2025-2", showAll: false });
  });

  it("sin prueba actual marcada y sin filtro: la lista queda abierta", () => {
    const r = resolvePeriodFilter("", null);
    expect(r).toEqual({ periodId: null, showAll: false });
  });

  it("ignora espacios en blanco (vienen de la URL)", () => {
    expect(resolvePeriodFilter("   ", "p-actual")).toEqual({
      periodId: "p-actual",
      showAll: false,
    });
    expect(resolvePeriodFilter(` ${ALL_PERIODS} `, "p-actual")).toEqual({
      periodId: null,
      showAll: true,
    });
  });

  it("'all' gana aunque no haya prueba actual", () => {
    const r = resolvePeriodFilter(ALL_PERIODS, null);
    expect(r).toEqual({ periodId: null, showAll: true });
  });
});
