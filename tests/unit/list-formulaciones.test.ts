/**
 * Tests del use case `ListFormulaciones` con un `FormulacionesReader` in-memory
 * (fake). Cubre:
 *   - scoping multi-tenant: el use case llama al reader con `actor.institutionId`
 *   - scoping por rol: TEACHER y ECU_LIDER devuelven FORBIDDEN
 *   - happy path: el reader devuelve lo que tiene y se entrega sin transformación
 *   - edge: institutionId vacío → array vacío
 *
 * Sin tocar la BD: el fetcher Prisma (`PrismaFormulacionesReader`) se testea
 * en tests de integración si se necesita en el futuro. Aquí solo verificamos
 * el contrato del use case.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  ListFormulaciones,
  type FormulacionesReader,
} from "@/modules/consultas/application/list-formulaciones";
import type { FormulacionRow } from "@/modules/consultas/domain/queries/formulaciones/formulacion-row";
import {
  applyFormulacionesFilters,
  parseFormulacionesFilters,
} from "@/modules/consultas/domain/queries/formulaciones/filters";

const ecuMaster: AuthenticatedUser = {
  userId: "u-master",
  institutionId: "inst-1",
  roles: ["ECU_MASTER"],
};
const superAdmin: AuthenticatedUser = {
  userId: "u-super",
  institutionId: "inst-1", // super admin también tiene institutionId obligatorio
  roles: ["SUPER_ADMIN"],
};
const teacher: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};
const lider: AuthenticatedUser = {
  userId: "u-lider",
  institutionId: "inst-1",
  roles: ["ECU_LIDER"],
};

function fakeRow(overrides: Partial<FormulacionRow> = {}): FormulacionRow {
  return {
    id: "ev-1",
    title: "Parcial 1",
    subjectName: "Matemáticas",
    courseName: "8°",
    academicYearYear: 2026,
    periodId: null,
    periodName: null,
    bookletTypeId: null,
    bookletTypeName: null,
    status: "DRAFT",
    authorName: "Docente A",
    assignedTeachers: [],
    itemsTotal: 10,
    itemsExpected: 10,
    itemsBadge: "ok",
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

class InMemoryFormulacionesReader implements FormulacionesReader {
  public lastInstitutionId: string | null = null;
  constructor(private rows: FormulacionRow[]) {}
  async listByInstitution(institutionId: string) {
    this.lastInstitutionId = institutionId;
    // El scoping multi-tenant real vive en el fetcher Prisma (es WHERE
    // institutionId = ... a nivel de BD). En el in-memory asumimos que el
    // set ya viene filtrado por institución.
    return this.rows;
  }
}

describe("ListFormulaciones", () => {
  let rows: FormulacionRow[];
  let reader: InMemoryFormulacionesReader;
  let useCase: ListFormulaciones;

  beforeEach(() => {
    rows = [
      fakeRow({ id: "ev-1", title: "Parcial Matemáticas 8°" }),
      fakeRow({
        id: "ev-2",
        title: "Quiz Física 9°",
        subjectName: "Física",
        courseName: "9°",
        itemsTotal: 5,
        itemsExpected: 10,
        itemsBadge: "low",
      }),
    ];
    reader = new InMemoryFormulacionesReader(rows);
    useCase = new ListFormulaciones(reader);
  });

  it("ECU_MASTER ve todas las de su institución", async () => {
    const result = await useCase.execute({ actor: ecuMaster });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
    expect(reader.lastInstitutionId).toBe("inst-1");
  });

  it("SUPER_ADMIN también ve las de su institución (mismo scope)", async () => {
    const result = await useCase.execute({ actor: superAdmin });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
    expect(reader.lastInstitutionId).toBe("inst-1");
  });

  it("rechaza TEACHER con FORBIDDEN", async () => {
    const result = await useCase.execute({ actor: teacher });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rechaza ECU_LIDER con FORBIDDEN (consultas es solo admin)", async () => {
    const result = await useCase.execute({ actor: lider });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("pasa el institutionId del actor al reader", async () => {
    await useCase.execute({
      actor: { ...ecuMaster, institutionId: "inst-otra" },
    });
    expect(reader.lastInstitutionId).toBe("inst-otra");
  });

  it("devuelve [] cuando no hay formulaciones", async () => {
    reader = new InMemoryFormulacionesReader([]);
    useCase = new ListFormulaciones(reader);
    const result = await useCase.execute({ actor: ecuMaster });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe("parseFormulacionesFilters + applyFormulacionesFilters (UI helper)", () => {
  const rows = [
    fakeRow({
      id: "ev-1",
      title: "Parcial Matemáticas",
      subjectName: "Matemáticas",
      courseName: "8°",
      status: "DRAFT",
      academicYearYear: 2026,
      authorName: "Ana",
    }),
    fakeRow({
      id: "ev-2",
      title: "Quiz Física",
      subjectName: "Física",
      courseName: "9°",
      status: "PUBLISHED",
      academicYearYear: 2026,
      authorName: "Bea",
    }),
    fakeRow({
      id: "ev-3",
      title: "Quiz Física 2",
      subjectName: "Física",
      courseName: "10°",
      status: "IN_REVIEW",
      academicYearYear: 2025,
      authorName: "Cal",
    }),
  ];

  it("search matchea en título, asignatura y autor", () => {
    const f = parseFormulacionesFilters({ search: "Física" });
    const out = applyFormulacionesFilters(rows, f);
    expect(out.map((r) => r.id)).toEqual(["ev-2", "ev-3"]);
  });

  it("search matchea también en autor (case-insensitive)", () => {
    const f = parseFormulacionesFilters({ search: "ana" });
    expect(applyFormulacionesFilters(rows, f).map((r) => r.id)).toEqual(["ev-1"]);
  });

  it("filtro por asignatura exacto", () => {
    const f = parseFormulacionesFilters({ subjectName: "Matemáticas" });
    expect(applyFormulacionesFilters(rows, f).map((r) => r.id)).toEqual(["ev-1"]);
  });

  it("filtro por grado (courseName) exacto", () => {
    const f = parseFormulacionesFilters({ courseName: "8°" });
    expect(applyFormulacionesFilters(rows, f).map((r) => r.id)).toEqual(["ev-1"]);
  });

  it("filtro por año académico", () => {
    const f = parseFormulacionesFilters({ academicYearYear: "2025" });
    expect(applyFormulacionesFilters(rows, f).map((r) => r.id)).toEqual(["ev-3"]);
  });

  it("filtro por estado", () => {
    const f = parseFormulacionesFilters({ status: "PUBLISHED" });
    expect(applyFormulacionesFilters(rows, f).map((r) => r.id)).toEqual(["ev-2"]);
  });

  it("combina search + subject + status (AND)", () => {
    const f = parseFormulacionesFilters({
      search: "Física",
      subjectName: "Física",
      status: "IN_REVIEW",
    });
    expect(applyFormulacionesFilters(rows, f).map((r) => r.id)).toEqual(["ev-3"]);
  });

  it("ignora filtros vacíos o inválidos", () => {
    const f = parseFormulacionesFilters({
      search: "   ",
      subjectName: "",
      academicYearYear: "abc",
      status: "INVALID",
    });
    expect(Object.keys(f)).toHaveLength(0);
    expect(applyFormulacionesFilters(rows, f)).toEqual(rows);
  });
});
