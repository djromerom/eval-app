/**
 * Tests de la consulta "Docentes formuladores por cuadernillo".
 *
 * Cubre las 3 capas puras/testeables sin BD:
 *   - el use case `ListFormuladores` (scoping multi-tenant y por rol),
 *   - el cruce `construirFilasFormuladores` (asignaciones + formulaciones),
 *   - los filtros y el formatter XLSX.
 *
 * El fetcher Prisma (`PrismaFormuladoresReader`) no se testea aquí: solo
 * traduce de Prisma a los tipos de entrada del cruce.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  ListFormuladores,
  type FormuladoresReader,
} from "@/modules/consultas/application/list-formuladores";
import type { FormuladorRow } from "@/modules/consultas/domain/queries/formuladores/formulador-row";
import {
  construirFilasFormuladores,
  type AsignacionDocente,
  type FormulacionDocente,
} from "@/modules/consultas/domain/queries/formuladores/cobertura";
import {
  applyFormuladoresFilters,
  parseFormuladoresFilters,
} from "@/modules/consultas/domain/queries/formuladores/filters";
import { formuladorRowsToWorksheet } from "@/modules/consultas/domain/queries/formuladores/xlsx";

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

function fakeRow(overrides: Partial<FormuladorRow> = {}): FormuladorRow {
  return {
    id: "asignacion:a-1",
    origen: "asignacion",
    cuadernillo: "Estándar",
    prueba: "I Periodo",
    anio: 2026,
    grado: "10-1",
    asignatura: "Matemáticas",
    formulador: "Ana Ruiz",
    tipoDocumento: "C.C.",
    documento: "123456",
    email: "ana@colegio.edu.co",
    celular: "3001234567",
    formulacion: null,
    estado: "pendiente",
    ...overrides,
  };
}

function fakeAsignacion(overrides: Partial<AsignacionDocente> = {}): AsignacionDocente {
  return {
    id: "a-1",
    tipoCuadernilloId: "bt-1",
    tipoCuadernillo: "Estándar",
    prueba: "I Periodo",
    anio: 2026,
    grado: "10-1",
    asignatura: "Matemáticas",
    courseSubjectId: "cs-1",
    docenteId: "u-ana",
    docenteNombre: "Ana Ruiz",
    tipoDocumento: "C.C.",
    documento: "123456",
    email: "ana@colegio.edu.co",
    celular: "3001234567",
    ...overrides,
  };
}

function fakeFormulacion(overrides: Partial<FormulacionDocente> = {}): FormulacionDocente {
  return {
    id: "ev-1",
    titulo: "Parcial 1",
    courseSubjectId: "cs-1",
    tipoCuadernilloId: "bt-1",
    prueba: "I Periodo",
    anio: 2026,
    grado: "10-1",
    asignatura: "Matemáticas",
    autorId: "u-ana",
    autorNombre: "Ana Ruiz",
    email: "ana@colegio.edu.co",
    tipoDocumento: "C.C.",
    documento: "123456",
    celular: "3001234567",
    cuadernillo: "Cuadernillo 1",
    ...overrides,
  };
}

class InMemoryFormuladoresReader implements FormuladoresReader {
  public lastInstitutionId: string | null = null;
  constructor(private rows: FormuladorRow[]) {}
  async listByInstitution(institutionId: string) {
    this.lastInstitutionId = institutionId;
    return this.rows;
  }
}

describe("ListFormuladores", () => {
  let rows: FormuladorRow[];
  let reader: InMemoryFormuladoresReader;
  let useCase: ListFormuladores;

  beforeEach(() => {
    rows = [
      fakeRow({ id: "asignacion:a-1", formulador: "Ana Ruiz" }),
      fakeRow({
        id: "formulacion:ev-2",
        origen: "formulacion",
        cuadernillo: "Cuadernillo 2",
        formulador: "Luis Pérez",
        estado: "formulado",
      }),
    ];
    reader = new InMemoryFormuladoresReader(rows);
    useCase = new ListFormuladores(reader);
  });

  it("ECU_MASTER ve todas las de su institución", async () => {
    const result = await useCase.execute({ actor: ecuMaster });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
    expect(reader.lastInstitutionId).toBe("inst-1");
  });

  it("SUPER_ADMIN también ve las de su institución (mismo scope)", async () => {
    const result = await useCase.execute({ actor: superAdmin });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);
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
    await useCase.execute({ actor: { ...ecuMaster, institutionId: "inst-otra" } });
    expect(reader.lastInstitutionId).toBe("inst-otra");
  });

  it("devuelve [] cuando no hay filas", async () => {
    useCase = new ListFormuladores(new InMemoryFormuladoresReader([]));
    const result = await useCase.execute({ actor: ecuMaster });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe("construirFilasFormuladores (cruce asignaciones + formulaciones)", () => {
  it("una asignación sin formulación → 1 fila 'pendiente'", () => {
    const rows = construirFilasFormuladores([fakeAsignacion()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estado).toBe("pendiente");
    expect(rows[0]!.origen).toBe("asignacion");
    expect(rows[0]!.formulacion).toBeNull();
    expect(rows[0]!.cuadernillo).toBe("Estándar");
  });

  it("asignación cubierta por la formulación del MISMO docente → 'formulado'", () => {
    const rows = construirFilasFormuladores([fakeAsignacion()], [fakeFormulacion()]);
    expect(rows).toHaveLength(1); // la formulación no genera fila extra
    expect(rows[0]!.estado).toBe("formulado");
    expect(rows[0]!.formulacion).toBe("Parcial 1");
  });

  it("asignación cubierta por la formulación de OTRO docente → 'formulado-por-otro'", () => {
    const rows = construirFilasFormuladores(
      [fakeAsignacion()],
      [fakeFormulacion({ autorId: "u-otro", autorNombre: "Luis Pérez" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estado).toBe("formulado-por-otro");
  });

  it("asignación con tipo de cuadernillo NO cubre la formulación de otro tipo", () => {
    const rows = construirFilasFormuladores(
      [fakeAsignacion({ tipoCuadernilloId: "bt-1", tipoCuadernillo: "Estándar" })],
      [fakeFormulacion({ tipoCuadernilloId: "bt-2" })],
    );
    // 1 fila de asignación (pendiente) + 1 fila de la formulación sin cubrir.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.estado).sort()).toEqual(["formulado", "pendiente"]);
    expect(rows.find((r) => r.origen === "formulacion")).toBeDefined();
  });

  it("asignación 'cualquier cuadernillo' (tipo null) cubre la formulación con tipo", () => {
    const rows = construirFilasFormuladores(
      [fakeAsignacion({ tipoCuadernilloId: null, tipoCuadernillo: null })],
      [fakeFormulacion({ tipoCuadernilloId: "bt-2" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estado).toBe("formulado");
    expect(rows[0]!.cuadernillo).toBe("Cualquier cuadernillo");
  });

  it("formulación SIN asignación → fila propia con origen 'formulacion'", () => {
    const rows = construirFilasFormuladores([], [fakeFormulacion()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.origen).toBe("formulacion");
    expect(rows[0]!.estado).toBe("formulado");
    expect(rows[0]!.formulador).toBe("Ana Ruiz");
    expect(rows[0]!.cuadernillo).toBe("Cuadernillo 1");
  });

  it("cada docente asignado produce su propia fila (2 asignaciones = 2 filas)", () => {
    const rows = construirFilasFormuladores(
      [
        fakeAsignacion({ id: "a-1", docenteId: "u-ana", docenteNombre: "Ana Ruiz" }),
        fakeAsignacion({ id: "a-2", docenteId: "u-luis", docenteNombre: "Luis Pérez" }),
      ],
      [fakeFormulacion()],
    );
    expect(rows).toHaveLength(2);
    const estados = rows.map((r) => r.estado).sort();
    expect(estados).toEqual(["formulado", "formulado-por-otro"]);
  });

  it("ordena por grado → asignatura → cuadernillo → docente", () => {
    const rows = construirFilasFormuladores(
      [
        fakeAsignacion({ id: "a-1", grado: "9-1", asignatura: "Física", docenteNombre: "Zoe" }),
        fakeAsignacion({
          id: "a-2",
          grado: "10-1",
          asignatura: "Matemáticas",
          docenteNombre: "Ana",
        }),
        fakeAsignacion({ id: "a-3", grado: "10-1", asignatura: "Física", docenteNombre: "Luis" }),
      ],
      [],
    );
    expect(rows.map((r) => `${r.grado}-${r.asignatura}`)).toEqual([
      "10-1-Física",
      "10-1-Matemáticas",
      "9-1-Física",
    ]);
  });
});

describe("parseFormuladoresFilters + applyFormuladoresFilters (UI helper)", () => {
  const rows = [
    fakeRow({ id: "f-1", formulador: "Ana Ruiz", cuadernillo: "Estándar", estado: "formulado" }),
    fakeRow({
      id: "f-2",
      formulador: "Luis Pérez",
      cuadernillo: "Especial",
      grado: "9-1",
      asignatura: "Física",
      email: "luis@colegio.edu.co",
      estado: "pendiente",
    }),
    fakeRow({
      id: "f-3",
      origen: "formulacion",
      formulador: "Caro Díaz",
      cuadernillo: "Cuadernillo 3",
      grado: "8-1",
      asignatura: "Biología",
      estado: "formulado-por-otro",
    }),
  ];

  it("search matchea en docente, cuadernillo, grado, asignatura y email", () => {
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ search: "Luis" })).map((r) => r.id),
    ).toEqual(["f-2"]);
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ search: "Especial" })).map(
        (r) => r.id,
      ),
    ).toEqual(["f-2"]);
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ search: "9-1" })).map((r) => r.id),
    ).toEqual(["f-2"]);
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ search: "Física" })).map(
        (r) => r.id,
      ),
    ).toEqual(["f-2"]);
    expect(applyFormuladoresFilters(rows, parseFormuladoresFilters({ search: "caro@" }))).toEqual(
      [],
    );
  });

  it("filtro por cuadernillo, grado y asignatura exactos", () => {
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ cuadernillo: "Estándar" })).map(
        (r) => r.id,
      ),
    ).toEqual(["f-1"]);
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ grado: "8-1" })).map((r) => r.id),
    ).toEqual(["f-3"]);
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ asignatura: "Biología" })).map(
        (r) => r.id,
      ),
    ).toEqual(["f-3"]);
  });

  it("filtro por estado", () => {
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ estado: "formulado" })).map(
        (r) => r.id,
      ),
    ).toEqual(["f-1"]);
    expect(
      applyFormuladoresFilters(rows, parseFormuladoresFilters({ estado: "pendiente" })).map(
        (r) => r.id,
      ),
    ).toEqual(["f-2"]);
  });

  it("combina search + estado (AND)", () => {
    const f = parseFormuladoresFilters({ search: "Estándar", estado: "formulado" });
    expect(applyFormuladoresFilters(rows, f).map((r) => r.id)).toEqual(["f-1"]);
  });

  it("ignora filtros vacíos o inválidos", () => {
    const f = parseFormuladoresFilters({
      search: "   ",
      cuadernillo: "",
      grado: "",
      estado: "INVALID",
    });
    expect(Object.keys(f)).toHaveLength(0);
    expect(applyFormuladoresFilters(rows, f)).toEqual(rows);
  });
});

describe("formuladorRowsToWorksheet", () => {
  it("devuelve un Buffer no-vacío con magic header PK (xlsx = zip)", () => {
    const buf = formuladorRowsToWorksheet([fakeRow()]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("el header tiene las 8 columnas pedidas primero y las 3 de apoyo al final", () => {
    const buf = formuladorRowsToWorksheet([]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [header] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(header).toEqual([
      "Cuadernillo",
      "Grado",
      "Asignatura",
      "Formulador",
      "Tipo doc.",
      "ID",
      "Email",
      "Celular",
      "Prueba",
      "Formulación",
      "Estado",
    ]);
  });

  it("la fila conserva el orden de las columnas", () => {
    const buf = formuladorRowsToWorksheet([fakeRow()]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(data[0]).toBe("Estándar");
    expect(data[1]).toBe("10-1");
    expect(data[2]).toBe("Matemáticas");
    expect(data[3]).toBe("Ana Ruiz");
    expect(data[4]).toBe("C.C.");
    expect(data[5]).toBe("123456");
    expect(data[6]).toBe("ana@colegio.edu.co");
    expect(data[7]).toBe("3001234567");
    expect(data[8]).toBe("I Periodo · 2026");
    expect(data[10]).toBe("Pendiente");
  });

  it("los datos de contacto que faltan van como celda vacía", () => {
    const buf = formuladorRowsToWorksheet([
      fakeRow({ tipoDocumento: null, documento: null, email: null, celular: null }),
    ]);
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const [, data = []] = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
    expect(data[4]).toBe("");
    expect(data[5]).toBe("");
    expect(data[6]).toBe("");
    expect(data[7]).toBe("");
  });

  it("listado vacío → workbook solo con headers", () => {
    const buf = formuladorRowsToWorksheet([]);
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Formuladores");
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Formuladores"]!, { header: 1 });
    expect(rows).toHaveLength(1);
  });
});
