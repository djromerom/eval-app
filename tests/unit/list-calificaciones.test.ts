/**
 * Tests del use case `ListCalificaciones` con reader y scope in-memory.
 *
 * Lo que se fija acá es la regla de acceso, que es la razón de existir del use
 * case: el ECU_LIDER ve solo sus grados, y ese recorte ocurre en el servidor.
 * Un test que solo mirara la UI no lo probaría — el filtro de la tabla es UX.
 */
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  ListCalificaciones,
  type CalificacionesReader,
  type LeaderScopeReader,
} from "@/modules/consultas/application/list-calificaciones";
import type { CalificacionRow } from "@/modules/consultas/domain/queries/calificaciones/calificacion-row";
import {
  applyCalificacionesFilters,
  parseCalificacionesFilters,
} from "@/modules/consultas/domain/queries/calificaciones/filters";
import { calcularPuntaje } from "@/modules/consultas/domain/queries/calificaciones/puntaje";

const master: AuthenticatedUser = { userId: "u1", institutionId: "i1", roles: ["ECU_MASTER"] };
const lider: AuthenticatedUser = { userId: "u2", institutionId: "i1", roles: ["ECU_LIDER"] };
const teacher: AuthenticatedUser = { userId: "u3", institutionId: "i1", roles: ["TEACHER"] };
const liderYMaster: AuthenticatedUser = {
  userId: "u4",
  institutionId: "i1",
  roles: ["ECU_LIDER", "ECU_MASTER"],
};

function fila(over: Partial<CalificacionRow> = {}): CalificacionRow {
  return {
    sheetId: "s1", batchId: "b1", studentName: "PEREZ, ANA", studentCode: "100",
    courseId: "c1", courseName: "6°", groupId: "g1", groupName: "6-01",
    assessmentName: "Simulacro",
    periodId: "p1", periodName: "I Periodo",
    bookletTypeId: "bt1", bookletTypeName: "Estándar",
    status: "GRADED", graded: true,
    totalCorrect: 8, totalQuestions: 10, puntaje: 8,
    scannedAt: new Date("2026-09-01"), ...over,
  };
}

/** Registra con qué argumentos se llamó, para verificar el recorte. */
class ReaderFake implements CalificacionesReader {
  llamadas: { institutionId: string; courseIds?: string[] }[] = [];
  constructor(private readonly filas: CalificacionRow[] = []) {}
  async listByInstitution(institutionId: string, courseIds?: string[]) {
    this.llamadas.push({ institutionId, courseIds });
    return courseIds ? this.filas.filter((f) => f.courseId && courseIds.includes(f.courseId)) : this.filas;
  }
}
class ScopeFake implements LeaderScopeReader {
  constructor(private readonly cursos: string[]) {}
  async listAssignedCourseIds() {
    return this.cursos;
  }
}

describe("ListCalificaciones — acceso", () => {
  it("el TEACHER no puede correr la consulta", async () => {
    const r = await new ListCalificaciones(new ReaderFake(), new ScopeFake([])).execute({ actor: teacher });
    expect(r.ok).toBe(false);
  });

  it("el ECU_MASTER ve toda la institución, sin recorte por grado", async () => {
    const reader = new ReaderFake([fila()]);
    const r = await new ListCalificaciones(reader, new ScopeFake([])).execute({ actor: master });
    expect(r.ok).toBe(true);
    expect(reader.llamadas[0]).toEqual({ institutionId: "i1", courseIds: undefined });
  });

  it("el ECU_LIDER se acota a sus grados asignados", async () => {
    const reader = new ReaderFake([fila({ courseId: "c1" }), fila({ sheetId: "s2", courseId: "c9" })]);
    const r = await new ListCalificaciones(reader, new ScopeFake(["c1"])).execute({ actor: lider });
    expect(r.ok).toBe(true);
    expect(reader.llamadas[0]!.courseIds).toEqual(["c1"]);
    if (r.ok) expect(r.value.map((f) => f.sheetId)).toEqual(["s1"]);
  });

  it("un líder sin grados asignados no ve nada y no consulta la BD", async () => {
    const reader = new ReaderFake([fila()]);
    const r = await new ListCalificaciones(reader, new ScopeFake([])).execute({ actor: lider });
    expect(r.ok && r.value).toEqual([]);
    // Clave: [] no debe degradar a "sin filtro" y devolver toda la institución.
    expect(reader.llamadas).toHaveLength(0);
  });

  it("si es líder y master a la vez, gana el rol más amplio", async () => {
    const reader = new ReaderFake([fila()]);
    await new ListCalificaciones(reader, new ScopeFake(["c1"])).execute({ actor: liderYMaster });
    expect(reader.llamadas[0]!.courseIds).toBeUndefined();
  });

  it("siempre consulta con la institución del actor", async () => {
    const reader = new ReaderFake();
    await new ListCalificaciones(reader, new ScopeFake([])).execute({
      actor: { ...master, institutionId: "otra" },
    });
    expect(reader.llamadas[0]!.institutionId).toBe("otra");
  });
});

describe("filtros de calificaciones", () => {
  const filas = [
    fila({ sheetId: "a", courseId: "c1", groupId: "g1", graded: true }),
    fila({ sheetId: "b", courseId: "c1", groupId: "g2", graded: false }),
    fila({ sheetId: "c", courseId: "c2", groupId: "g3", graded: true }),
    fila({ sheetId: "d", courseId: "c3", groupId: "g4", graded: false }),
  ];

  it("filtra por grado", () => {
    expect(applyCalificacionesFilters(filas, { courseId: "c1" }).map((f) => f.sheetId)).toEqual(["a", "b"]);
  });
  it("filtra por grupo", () => {
    expect(applyCalificacionesFilters(filas, { groupId: "g2" }).map((f) => f.sheetId)).toEqual(["b"]);
  });
  it("filtra pendientes (identificadas pero aún sin puntaje)", () => {
    expect(applyCalificacionesFilters(filas, { estado: "pendientes" }).map((f) => f.sheetId)).toEqual(["b", "d"]);
  });
  it("filtra por prueba (periodo)", () => {
    const conPeriodos = [
      fila({ sheetId: "x", periodId: "p1" }),
      fila({ sheetId: "y", periodId: "p2" }),
      fila({ sheetId: "z", periodId: null }),
    ];
    expect(applyCalificacionesFilters(conPeriodos, { periodId: "p2" }).map((f) => f.sheetId)).toEqual(["y"]);
  });

  it("filtra por tipo de cuadernillo, y las filas sin tipo quedan fuera", () => {
    const conTipos = [
      fila({ sheetId: "x", bookletTypeId: "bt1" }),
      fila({ sheetId: "y", bookletTypeId: null }),
    ];
    expect(applyCalificacionesFilters(conTipos, { bookletTypeId: "bt1" }).map((f) => f.sheetId)).toEqual(["x"]);
  });

  it("grado y grupo incompatibles dan vacío", () => {
    expect(applyCalificacionesFilters(filas, { courseId: "c2", groupId: "g1" })).toEqual([]);
  });
  it("sin filtros devuelve todo", () => {
    expect(applyCalificacionesFilters(filas, {})).toHaveLength(4);
  });

  it("parsea searchParams y descarta basura", () => {
    expect(
      parseCalificacionesFilters({ courseId: " c1 ", groupId: "", periodId: " p1 ", estado: "raro" }),
    ).toEqual({ courseId: "c1", periodId: "p1" });
    expect(parseCalificacionesFilters({ estado: "pendientes" })).toEqual({ estado: "pendientes" });
  });
});

describe("calcularPuntaje — escala 0-10 con piso de 3", () => {
  it("es 10 * aciertos / total", () => {
    expect(calcularPuntaje(95, 95)).toBe(10);
    expect(calcularPuntaje(50, 100)).toBe(5);
    expect(calcularPuntaje(32, 95)).toBe(3.4); // 3.368 -> 1 decimal
  });

  it("nunca baja de 3, por bajo que sea el resultado", () => {
    expect(calcularPuntaje(0, 95)).toBe(3);
    expect(calcularPuntaje(17, 95)).toBe(3); // crudo 1.8
    expect(calcularPuntaje(28, 95)).toBe(3); // crudo 2.9
  });

  it("justo por encima del piso ya no se recorta", () => {
    expect(calcularPuntaje(29, 95)).toBe(3.1); // crudo 3.05
  });

  it("sin datos suficientes devuelve null, no 3", () => {
    // Importante: una hoja sin calificar no es un 3; es "todavía no hay nota".
    expect(calcularPuntaje(null, 95)).toBeNull();
    expect(calcularPuntaje(10, null)).toBeNull();
    expect(calcularPuntaje(10, 0)).toBeNull();
  });
});
