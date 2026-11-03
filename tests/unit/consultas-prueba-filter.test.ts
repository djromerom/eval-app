/**
 * Tests del filtro por Prueba de la consulta "Listado de Formulaciones" y
 * del use case `ListPruebas`.
 *
 * Cubre:
 *   - `pruebaActual`: resuelve la prueba en curso (actual del año actual →
 *     actual de cualquier año → ninguna) y devuelve `null` cuando no hay
 *     ninguna marcada (el filtro queda en "todas las pruebas").
 *   - `parseFormulacionesFilters` / `applyFormulacionesFilters` con el
 *     criterio de prueba.
 *   - `ListPruebas`: scoping por tenant y por rol.
 *
 * Sin tocar la BD: el reader de pruebas se sustituye por un fake.
 */
import { describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import { ListPruebas, type PruebasReader } from "@/modules/consultas/application/list-pruebas";
import { pruebaActual, type PruebaOpcion } from "@/modules/consultas/domain/shared/prueba-opcion";
import {
  applyFormulacionesFilters,
  parseFormulacionesFilters,
} from "@/modules/consultas/domain/queries/formulaciones/filters";
import { filtrosIniciales } from "@/app/(dashboard)/admin/consultas/[id]/_components/formulaciones-filter-row";

const ecuMaster: AuthenticatedUser = {
  userId: "u-master",
  institutionId: "inst-1",
  roles: ["ECU_MASTER"],
};
const superAdmin: AuthenticatedUser = {
  userId: "u-super",
  institutionId: "inst-1",
  roles: ["SUPER_ADMIN"],
};
const teacher: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};

function prueba(over: Partial<PruebaOpcion> = {}): PruebaOpcion {
  return {
    id: "p-1",
    name: "I Periodo",
    academicYearId: "ay-1",
    year: 2026,
    isCurrent: false,
    yearIsCurrent: false,
    ...over,
  };
}

describe("pruebaActual — la prueba en curso", () => {
  it("prefiere la prueba actual del año académico actual", () => {
    const actual = prueba({ id: "p-actual", isCurrent: true, yearIsCurrent: true });
    const deOtroAno = prueba({ id: "p-otro", isCurrent: true, yearIsCurrent: false });
    expect(pruebaActual([deOtroAno, actual])?.id).toBe("p-actual");
  });

  it("si el año actual no tiene prueba marcada, toma la actual de cualquier año", () => {
    const deOtroAno = prueba({ id: "p-otro", isCurrent: true, yearIsCurrent: false });
    expect(pruebaActual([prueba(), deOtroAno])?.id).toBe("p-otro");
  });

  it("devuelve null si ninguna prueba está marcada como actual", () => {
    // El filtro queda en "todas las pruebas": cerrarlo sobre la primera de
    // la lista dejaría fuera el resto sin que nadie lo pidiera.
    expect(pruebaActual([prueba(), prueba({ id: "p-2" })])).toBeNull();
    expect(pruebaActual([])).toBeNull();
  });
});

describe("filtro por prueba — Listado de Formulaciones", () => {
  const row = (over: Partial<{ id: string }> & Record<string, unknown> = {}) => ({
    title: "Parcial",
    subjectName: "Matemáticas",
    courseName: "8°",
    periodId: "p-1",
    academicYearYear: 2026,
    status: "DRAFT" as const,
    authorName: "Docente A",
    ...over,
  });

  it("parsea las pruebas desde los searchParams (lista separada por comas)", () => {
    expect(parseFormulacionesFilters({ periodIds: "p-9" })).toEqual({ periodIds: ["p-9"] });
    expect(parseFormulacionesFilters({ periodIds: "p-1,p-2" })).toEqual({
      periodIds: ["p-1", "p-2"],
    });
    expect(parseFormulacionesFilters({ periodIds: "" })).toEqual({});
    expect(parseFormulacionesFilters({ periodIds: "   " })).toEqual({});
  });

  it("filtra las filas por una prueba", () => {
    const rows = [row({ periodId: "p-1" }), row({ id: "e-2", periodId: "p-2" })];
    const filtradas = applyFormulacionesFilters(rows, { periodIds: ["p-2"] });
    expect(filtradas).toHaveLength(1);
    expect(filtradas[0]?.periodId).toBe("p-2");
  });

  it("sin filtro de prueba devuelve todas las filas", () => {
    const rows = [row({ periodId: "p-1" }), row({ periodId: null })];
    expect(applyFormulacionesFilters(rows, {})).toHaveLength(2);
  });

  it("las formulaciones sin prueba no pasan el filtro de una prueba", () => {
    const rows = [row({ periodId: null })];
    expect(applyFormulacionesFilters(rows, { periodIds: ["p-1"] })).toHaveLength(0);
  });
});

describe("filtrosIniciales — el filtro arranca en la prueba en curso", () => {
  it("preselecciona la prueba que viene por defecto", () => {
    expect(filtrosIniciales("p-1").periodId).toBe("p-1");
  });

  it("sin prueba en curso el filtro queda en todas las pruebas", () => {
    expect(filtrosIniciales(null).periodId).toBe("");
  });

  it("los demás filtros arrancan abiertos", () => {
    const f = filtrosIniciales("p-1");
    expect(f.search).toBe("");
    expect(f.subjectName).toBe("");
    expect(f.courseName).toBe("");
    expect(f.academicYearYear).toBeNull();
    expect(f.status).toBe("");
  });
});

describe("ListPruebas — use case", () => {
  it("devuelve las pruebas de la institución del actor", async () => {
    const calls: string[] = [];
    const reader: PruebasReader = {
      listByInstitution: async (institutionId) => {
        calls.push(institutionId);
        return [prueba()];
      },
    };
    const res = await new ListPruebas(reader).execute({ actor: ecuMaster });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toHaveLength(1);
    expect(calls).toEqual(["inst-1"]);
  });

  it("el super admin también puede listar pruebas", async () => {
    const reader: PruebasReader = { listByInstitution: async () => [prueba()] };
    const res = await new ListPruebas(reader).execute({ actor: superAdmin });
    expect(res.ok).toBe(true);
  });

  it("un docente no puede listar pruebas", async () => {
    const reader: PruebasReader = { listByInstitution: async () => [prueba()] };
    const res = await new ListPruebas(reader).execute({ actor: teacher });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });

  it("el líder ECU puede listar las pruebas (opciones del filtro)", async () => {
    // Las pruebas son los nombres del catálogo de la institución, no datos de
    // otros grados: el recorte de las filas lo hace `ListFormulaciones`.
    const reader: PruebasReader = { listByInstitution: async () => [prueba()] };
    const res = await new ListPruebas(reader).execute({
      actor: { userId: "u-lider", institutionId: "inst-1", roles: ["ECU_LIDER"] },
    });
    expect(res.ok).toBe(true);
  });
});
