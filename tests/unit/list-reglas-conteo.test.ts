/**
 * Tests del use case `ListReglasConteo` con un `ReglasConteoReader` in-memory
 * (fake) y de los filtros de la consulta.
 *
 * Cubre:
 *   - scoping multi-tenant: el use case llama al reader con `actor.institutionId`
 *   - scoping por rol: TEACHER y ECU_LIDER devuelven FORBIDDEN
 *   - happy path: el reader devuelve lo que tiene y se entrega sin transformación
 *   - filtros: parse desde searchParams y apply sobre las filas
 *
 * Sin tocar la BD: el fetcher Prisma (`PrismaReglasConteoReader`) se testea
 * en integración si hace falta. Aquí verificamos el contrato del use case.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  ListReglasConteo,
  type ReglasConteoReader,
} from "@/modules/consultas/application/list-reglas-conteo";
import type { ReglaConteoRow } from "@/modules/consultas/domain/queries/reglas-conteo/regla-conteo-row";
import {
  applyReglasConteoFilters,
  parseReglasConteoFilters,
} from "@/modules/consultas/domain/queries/reglas-conteo/filters";

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
const lider: AuthenticatedUser = {
  userId: "u-lider",
  institutionId: "inst-1",
  roles: ["ECU_LIDER"],
};

function fakeRow(overrides: Partial<ReglaConteoRow> = {}): ReglaConteoRow {
  return {
    id: "rule-1",
    periodId: "p-2026-2",
    periodName: "2026-2",
    academicYearYear: 2026,
    courseName: "6°",
    subjectName: "Matemáticas",
    bookletTypeName: "Estándar",
    exactQuestions: 25,
    formuladas: 2,
    ...overrides,
  };
}

class InMemoryReglasConteoReader implements ReglasConteoReader {
  rows: ReglaConteoRow[] = [];
  /** Guardamos el institutionId con el que nos llamaron (scoping). */
  calledWith: string | null = null;

  async listByInstitution(institutionId: string): Promise<ReglaConteoRow[]> {
    this.calledWith = institutionId;
    return this.rows;
  }
}

describe("ListReglasConteo", () => {
  let reader: InMemoryReglasConteoReader;

  beforeEach(() => {
    reader = new InMemoryReglasConteoReader();
  });

  it("entrega las filas del reader sin transformarlas", async () => {
    reader.rows = [fakeRow(), fakeRow({ id: "rule-2", exactQuestions: 40 })];

    const res = await new ListReglasConteo(reader).execute({ actor: ecuMaster });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);
    expect(res.value[0]?.exactQuestions).toBe(25);
    expect(res.value[1]?.exactQuestions).toBe(40);
  });

  it("scoping multi-tenant: llama al reader con el institutionId del actor", async () => {
    await new ListReglasConteo(reader).execute({ actor: ecuMaster });
    expect(reader.calledWith).toBe("inst-1");
  });

  it("devuelve [] cuando la institución no tiene reglas", async () => {
    const res = await new ListReglasConteo(reader).execute({ actor: ecuMaster });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toEqual([]);
  });

  it("SUPER_ADMIN puede correr la consulta", async () => {
    const res = await new ListReglasConteo(reader).execute({ actor: superAdmin });
    expect(res.ok).toBe(true);
  });

  it("TEACHER recibe FORBIDDEN", async () => {
    const res = await new ListReglasConteo(reader).execute({ actor: teacher });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.name).toBe("ForbiddenError");
  });

  it("ECU_LIDER recibe FORBIDDEN", async () => {
    const res = await new ListReglasConteo(reader).execute({ actor: lider });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.name).toBe("ForbiddenError");
  });
});

describe("filtros de reglas de conteo", () => {
  it("parse ignora valores vacíos", () => {
    expect(parseReglasConteoFilters({ periodId: "  ", courseName: undefined })).toEqual({});
  });

  it("parse recorta los valores", () => {
    const f = parseReglasConteoFilters({ periodId: " p-1 ", courseName: " 6° " });
    expect(f.periodId).toBe("p-1");
    expect(f.courseName).toBe("6°");
  });

  it("apply filtra por prueba, grado y asignatura", () => {
    const rows = [
      fakeRow({ id: "a", periodId: "p1", courseName: "6°", subjectName: "Matemáticas" }),
      fakeRow({ id: "b", periodId: "p1", courseName: "11°", subjectName: "Lenguaje" }),
      fakeRow({ id: "c", periodId: "p2", courseName: "6°", subjectName: "Lenguaje" }),
    ];

    expect(applyReglasConteoFilters(rows, { periodId: "p1" })).toHaveLength(2);
    expect(applyReglasConteoFilters(rows, { courseName: "6°" })).toHaveLength(2);
    expect(applyReglasConteoFilters(rows, { subjectName: "Lenguaje" })).toHaveLength(2);
    expect(applyReglasConteoFilters(rows, { periodId: "p1", courseName: "6°" })).toHaveLength(1);
    expect(applyReglasConteoFilters(rows, {})).toHaveLength(3);
  });
});
