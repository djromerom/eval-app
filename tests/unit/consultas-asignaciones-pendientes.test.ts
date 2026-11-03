/**
 * Tests de las **asignaciones pendientes** del listado de formulaciones: las
 * tuplas (Prueba × Grado × Asignatura × Tipo de cuadernillo) que la regla de
 * conteo exige y que todavía no tienen formulación.
 *
 * Cubre:
 *   - `ListAsignacionesPendientes`: scoping por tenant y por rol.
 *   - `applyPendientesFilters`: los mismos filtros que las formulaciones, con
 *     las dos reglas propias de este conjunto (sin estado de workflow, y
 *     búsqueda solo por asignatura).
 *
 * Sin tocar la BD: el reader se sustituye por un fake.
 */
import { describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  ListAsignacionesPendientes,
  type AsignacionesPendientesReader,
} from "@/modules/consultas/application/list-asignaciones-pendientes";
import type { AsignacionPendiente } from "@/modules/consultas/domain/queries/formulaciones/asignacion-pendiente";
import { applyPendientesFilters } from "@/modules/consultas/domain/queries/formulaciones/filters";

const ecuMaster: AuthenticatedUser = {
  userId: "u-master",
  institutionId: "inst-1",
  roles: ["ECU_MASTER"],
};
const teacher: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};

function pendiente(over: Partial<AsignacionPendiente> = {}): AsignacionPendiente {
  return {
    id: "rule-1",
    subjectName: "Inglés",
    courseName: "10",
    academicYearYear: 2026,
    periodId: "p-1",
    periodName: "2026-2",
    bookletTypeId: "bt-2",
    bookletTypeName: "Con Ajuste",
    itemsExpected: 25,
    assignedTeachers: ["Docente A"],
    ...over,
  };
}

describe("ListAsignacionesPendientes — use case", () => {
  it("devuelve las asignaciones pendientes de la institución del actor", async () => {
    const calls: string[] = [];
    const reader: AsignacionesPendientesReader = {
      listPending: async (institutionId) => {
        calls.push(institutionId);
        return [pendiente()];
      },
    };
    const res = await new ListAsignacionesPendientes(reader).execute({ actor: ecuMaster });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toHaveLength(1);
    expect(calls).toEqual(["inst-1"]);
  });

  it("un docente no puede listar asignaciones pendientes", async () => {
    const reader: AsignacionesPendientesReader = { listPending: async () => [pendiente()] };
    const res = await new ListAsignacionesPendientes(reader).execute({ actor: teacher });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("FORBIDDEN");
  });
});

describe("applyPendientesFilters — filtros de las asignaciones pendientes", () => {
  it("filtra por prueba", () => {
    const rows = [pendiente(), pendiente({ id: "rule-2", periodId: "p-2" })];
    const filtradas = applyPendientesFilters(rows, { periodIds: ["p-2"] });
    expect(filtradas).toHaveLength(1);
    expect(filtradas[0]?.periodId).toBe("p-2");
  });

  it("filtra por asignatura, grado y año", () => {
    const rows = [
      pendiente(),
      pendiente({ id: "rule-2", subjectName: "Matemáticas", courseName: "11" }),
    ];
    expect(applyPendientesFilters(rows, { subjectName: "Matemáticas" })).toHaveLength(1);
    expect(applyPendientesFilters(rows, { courseName: "10" })).toHaveLength(1);
    expect(applyPendientesFilters(rows, { academicYearYear: 2025 })).toHaveLength(0);
  });

  it("sin filtros devuelve todas las asignaciones pendientes", () => {
    const rows = [pendiente(), pendiente({ id: "rule-2" })];
    expect(applyPendientesFilters(rows, {})).toHaveLength(2);
  });

  it("un filtro por estado las excluye: no tienen estado de workflow", () => {
    const rows = [pendiente()];
    expect(applyPendientesFilters(rows, { status: "DRAFT" })).toHaveLength(0);
    expect(applyPendientesFilters(rows, { status: "PUBLISHED" })).toHaveLength(0);
  });

  it("la búsqueda libre matchea por asignatura", () => {
    const rows = [pendiente(), pendiente({ id: "rule-2", subjectName: "Matemáticas" })];
    expect(applyPendientesFilters(rows, { search: "ingl" })).toHaveLength(1);
    expect(applyPendientesFilters(rows, { search: "matem" })[0]?.subjectName).toBe("Matemáticas");
  });
});
