/**
 * Test de render del listado de formulaciones: el orden de las columnas y sus
 * títulos. Es un cambio de UI (la columna "Autor" pasó a llamarse
 * "Formulador" y seordenó después de "Asignados"), y un test de render lo
 * fija sin depender del navegador.
 *
 * `usePathname` se mockea: el botón de XLSX lo usa para armar el href y fuera
 * del App Router no hay contexto de Next.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/consultas/formulaciones",
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormulacionesTable } from "@/app/(dashboard)/admin/consultas/[id]/_components/formulaciones-table";
import type { FormulacionRow } from "@/modules/consultas/domain/queries/formulaciones/formulacion-row";
import type { AsignacionPendiente } from "@/modules/consultas/domain/queries/formulaciones/asignacion-pendiente";

function fila(over: Partial<FormulacionRow> = {}): FormulacionRow {
  return {
    id: "ev-1",
    title: "Formulación Demo",
    subjectName: "Matemáticas",
    courseName: "10°",
    academicYearYear: 2026,
    periodId: "p-1",
    periodName: "2026-2",
    bookletTypeId: "bt-1",
    bookletTypeName: "Estándar",
    status: "PUBLISHED",
    authorName: "María López",
    assignedTeachers: ["Carlos Ruiz"],
    itemsTotal: 20,
    itemsExpected: 20,
    itemsBadge: "ok",
    updatedAt: new Date("2026-09-03T12:00:00Z"),
    ...over,
  };
}

function pendiente(over: Partial<AsignacionPendiente> = {}): AsignacionPendiente {
  return {
    id: "rule-1",
    subjectName: "Inglés",
    courseName: "10°",
    academicYearYear: 2026,
    periodId: "p-1",
    periodName: "2026-2",
    bookletTypeId: "bt-2",
    bookletTypeName: "Con Ajuste",
    itemsExpected: 25,
    assignedTeachers: ["Ana Ruiz"],
    ...over,
  };
}

function render(rows: FormulacionRow[], pendientes: AsignacionPendiente[] = []): string {
  // `createElement` en vez de JSX: el runner de tests de este repo solo
  // recoge archivos `.test.ts` (no `.tsx`).
  return renderToStaticMarkup(
    createElement(FormulacionesTable, {
      rows,
      pendientes,
      title: "Listado de Formulaciones",
      description: "desc",
      pruebas: [],
      defaultPeriodId: null,
    }),
  );
}

/** Etiquetas de las cabeceras, en el orden en que salen en la tabla. */
function cabeceras(markup: string): string[] {
  return [...markup.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => (m[1] ?? "").trim());
}

describe("Listado de Formulaciones — columnas", () => {
  it("la columna del formulador va después de la de asignados", () => {
    const cols = cabeceras(render([fila()]));
    expect(cols).toEqual([
      "Asignatura",
      "Grado",
      "Año",
      "Prueba",
      "Tipo",
      "Estado",
      "Items",
      "Asignados",
      "Formulador",
      "Actualizado",
    ]);
  });

  it("ya no existe una columna llamada Autor", () => {
    const cols = cabeceras(render([fila()]));
    expect(cols).not.toContain("Autor");
    expect(cols).toContain("Formulador");
  });

  it("la fila muestra los docentes asignados y el formulador en ese orden", () => {
    const markup = render([fila()]);
    const cuerpo = markup.slice(markup.indexOf("<tbody>"));
    const posAsignados = cuerpo.indexOf("Carlos Ruiz");
    const posFormulador = cuerpo.indexOf("María López");
    expect(posAsignados).toBeGreaterThan(-1);
    expect(posFormulador).toBeGreaterThan(posAsignados);
  });

  it("las asignaciones pendientes también respetan el orden", () => {
    const markup = render([], [pendiente()]);
    const cuerpo = markup.slice(markup.indexOf("<tbody>"));
    const posAsignados = cuerpo.indexOf("Ana Ruiz");
    // El formulador no existe en una asignación pendiente: la celda queda vacía.
    expect(posAsignados).toBeGreaterThan(-1);
    expect(cuerpo).not.toContain("María López");
  });
});
