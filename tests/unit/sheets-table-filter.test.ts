import { describe, expect, it } from "vitest";
import {
  countSheetsByStatus,
  filterSheetsByStatus,
  type SheetRowForFilter,
} from "@/app/(dashboard)/teacher/scan/sheets-table";

function sheet(status: string, extras: Partial<SheetRowForFilter> = {}): SheetRowForFilter {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    status,
    studentName: null,
    studentCode: null,
    score: null,
    totalCorrect: null,
    totalQuestions: null,
    notes: null,
    ...extras,
  };
}

describe("filterSheetsByStatus", () => {
  it("set vacío devuelve la lista completa, sin mutar la entrada", () => {
    const rows = [sheet("REVIEW"), sheet("GRADED"), sheet("PENDING")];
    const before = rows.slice();
    const out = filterSheetsByStatus(rows, new Set());
    expect(out).toBe(rows); // misma referencia: el "atajo" del set vacío
    expect(rows).toEqual(before);
  });

  it("un estado seleccionado devuelve solo las filas que coinciden", () => {
    const rows = [sheet("REVIEW", { id: "a" }), sheet("GRADED"), sheet("REVIEW", { id: "b" })];
    const out = filterSheetsByStatus(rows, new Set(["REVIEW"]));
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    // la lista de entrada NO se muta
    expect(rows).toHaveLength(3);
  });

  it("varios estados funcionan como OR (unión)", () => {
    const rows = [
      sheet("REVIEW"),
      sheet("GRADED"),
      sheet("PENDING"),
      sheet("REVIEW"),
    ];
    const out = filterSheetsByStatus(rows, new Set(["REVIEW", "GRADED"]));
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.status === "REVIEW" || r.status === "GRADED")).toBe(true);
  });

  it("estados seleccionados que no existen en la lista → []", () => {
    const rows = [sheet("GRADED"), sheet("PENDING")];
    const out = filterSheetsByStatus(rows, new Set(["REVIEW"]));
    expect(out).toEqual([]);
  });
});

describe("countSheetsByStatus", () => {
  it("cuenta sobre la lista COMPLETA, no sobre el resultado filtrado", () => {
    const rows = [sheet("REVIEW"), sheet("GRADED"), sheet("GRADED"), sheet("PENDING")];
    const counts = countSheetsByStatus(rows);
    expect(counts.REVIEW).toBe(1);
    expect(counts.GRADED).toBe(2);
    expect(counts.PENDING).toBe(1);
    expect(counts.SCANNED).toBe(0);
    expect(counts.PROCESSING).toBe(0);
  });

  it("lista vacía devuelve todos los counts en cero", () => {
    const counts = countSheetsByStatus([]);
    expect(counts).toEqual({
      PENDING: 0,
      SCANNED: 0,
      PROCESSING: 0,
      GRADED: 0,
      REVIEW: 0,
    });
  });

  it("ignora estados fuera del vocabulario de hoja sin reventar", () => {
    const rows = [sheet("REVIEW"), sheet("PARTIAL"), sheet("FAILED")];
    const counts = countSheetsByStatus(rows);
    // REVIEW cuenta; PARTIAL/FAILED son estados del lote, no de la hoja
    // — se ignoran y los conteos válidos siguen en 0.
    expect(counts.REVIEW).toBe(1);
    expect(counts.GRADED).toBe(0);
    expect(counts.PENDING).toBe(0);
  });
});
