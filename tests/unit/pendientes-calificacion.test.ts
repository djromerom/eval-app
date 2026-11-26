/**
 * "Pendientes de calificación": consolidación pura (dominio) y acceso
 * (use case).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  type DatosPendientes,
  ListPendientesCalificacion,
  ListPendientesDePrueba,
  type PendientesCalificacionReader,
} from "@/modules/consultas/application/list-pendientes-calificacion";
import {
  type ConsolidarPendientesInput,
  type CuadernilloPendiente,
  type EstudiantePendiente,
  type HojaPendiente,
  consolidarPendientes,
} from "@/modules/consultas/domain/queries/pendientes-calificacion/consolidar";
import type { OpcionesPruebaGrupo } from "@/modules/consultas/domain/shared/opciones-prueba-grupo";

const master: AuthenticatedUser = { userId: "m", institutionId: "i1", roles: ["ECU_MASTER"] };
const lider: AuthenticatedUser = { userId: "l", institutionId: "i1", roles: ["ECU_LIDER"] };
const docente: AuthenticatedUser = { userId: "t", institutionId: "i1", roles: ["TEACHER"] };

// ========== helpers de fixtures ==========

function estudiante(id: string, over: Partial<EstudiantePendiente> = {}): EstudiantePendiente {
  return {
    id,
    code: `C-${id}`,
    lastName1: `Apellido${id}`,
    lastName2: "",
    firstName1: `Nombre${id}`,
    firstName2: "",
    activo: true,
    bookletTypeId: null,
    courseId: "c10",
    ...over,
  };
}

function cuadernillo(id: string, over: Partial<CuadernilloPendiente> = {}): CuadernilloPendiente {
  return {
    id,
    name: `Cuadernillo ${id}`,
    bookletTypeId: null,
    asignaturas: ["MAT", "FIS"],
    courseId: "c10",
    listo: true,
    ...over,
  };
}

function hoja(
  studentId: string,
  bundleId: string,
  over: Partial<HojaPendiente> = {},
): HojaPendiente {
  return {
    id: `h-${studentId}-${bundleId}`,
    studentId,
    bundleId,
    updatedAt: new Date("2026-11-01T10:00:00Z"),
    score: 10,
    totalCorrect: 10,
    totalQuestions: 20,
    status: "GRADED",
    createdAt: new Date("2026-11-01T09:00:00Z"),
    marcadas: 20,
    totalRespuestas: 20,
    ...over,
  };
}

function input(over: Partial<ConsolidarPendientesInput> = {}): ConsolidarPendientesInput {
  return {
    prueba: { id: "p-2026", name: "2026-2", year: 2026, academicYearId: "y26" },
    grupo: {
      id: "g-1001",
      name: "1001",
      courseName: "10",
      courseId: "c10",
      academicYearId: "y26",
    },
    estudiantes: [],
    cuadernillos: [],
    hojas: [],
    ...over,
  };
}

// ========== consolidación ==========

describe("consolidarPendientes", () => {
  it("el estudiante sin hoja del cuadernillo que le esperaba queda 'sin-hoja'", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.motivo).toBe("sin-hoja");
    expect(r.filas[0]?.studentId).toBe("e1");
    expect(r.filas[0]?.marcadas).toBeNull();
    expect(r.resumen).toEqual({ sinHoja: 1, sinCalificar: 0, sinMarcar: 0, total: 1 });
  });

  it("la hoja sin puntaje queda 'sin-calificar' y muestra el estado del escaneo", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
        hojas: [
          hoja("e1", "b1", {
            score: null,
            totalCorrect: null,
            totalQuestions: null,
            status: "REVIEW",
            marcadas: 0,
            totalRespuestas: 0,
          }),
        ],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.motivo).toBe("sin-calificar");
    expect(r.filas[0]?.estadoHoja).toBe("REVIEW");
    expect(r.filas[0]?.puntaje).toBeNull();
  });

  it("la hoja con nota pero sin una sola opción marcada queda 'sin-marcar'", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
        hojas: [
          hoja("e1", "b1", {
            score: 0,
            totalCorrect: 0,
            totalQuestions: 20,
            marcadas: 0,
            totalRespuestas: 20,
          }),
        ],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.motivo).toBe("sin-marcar");
    // Con piso institucional: 0 aciertos de 20 → 3.0
    expect(r.filas[0]?.puntaje).toBe(3);
    expect(r.filas[0]?.marcadas).toBe(0);
    expect(r.filas[0]?.totalRespuestas).toBe(20);
  });

  it("el estudiante que respondió (aunque se equivocara) no sale", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
        hojas: [
          hoja("e1", "b1", {
            score: 0,
            totalCorrect: 0,
            totalQuestions: 20,
            marcadas: 20,
            totalRespuestas: 20,
          }),
        ],
      }),
    );

    expect(r.filas).toHaveLength(0);
    expect(r.resumen.total).toBe(0);
  });

  it("un cuadernillo de otro tipo no se le espera al estudiante", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1", { bookletTypeId: "estandar" })],
        cuadernillos: [cuadernillo("b1", { bookletTypeId: "especial" })],
      }),
    );

    expect(r.filas).toHaveLength(0);
  });

  it("un cuadernillo del mismo tipo sí se le espera", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1", { bookletTypeId: "especial" })],
        cuadernillos: [cuadernillo("b1", { bookletTypeId: "especial" })],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.motivo).toBe("sin-hoja");
  });

  it("un cuadernillo en DRAFT no se imprimió: no se le espera a nadie", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1", { listo: false })],
      }),
    );

    expect(r.filas).toHaveLength(0);
  });

  it("la hoja de un cuadernillo de otro grado se revisa igual", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1", { courseId: "c11" })],
        hojas: [hoja("e1", "b1", { score: null, totalCorrect: null, totalQuestions: null })],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.motivo).toBe("sin-calificar");
  });

  it("un cuadernillo de otro grado no se le espera: no sale como 'sin-hoja'", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1", { courseId: "c11" })],
      }),
    );

    expect(r.filas).toHaveLength(0);
  });

  it("un compendio sin curso (cross-grado) se le espera a todos", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1", { courseId: "c11" })],
        cuadernillos: [cuadernillo("b1", { courseId: null })],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.motivo).toBe("sin-hoja");
  });

  it("con dos hojas del mismo estudiante y cuadernillo manda la más reciente", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
        hojas: [
          hoja("e1", "b1", {
            id: "vieja",
            updatedAt: new Date("2026-11-01T10:00:00Z"),
            score: null,
            totalCorrect: null,
            totalQuestions: null,
          }),
          hoja("e1", "b1", {
            id: "nueva",
            updatedAt: new Date("2026-11-02T10:00:00Z"),
            score: 10,
            totalCorrect: 10,
            totalQuestions: 20,
          }),
        ],
      }),
    );

    // La hoja vigente ya tiene nota y respuestas → no sale.
    expect(r.filas).toHaveLength(0);
  });

  it("desempata por id cuando dos hojas tienen la misma fecha", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
        hojas: [
          hoja("e1", "b1", {
            id: "a",
            score: null,
            totalCorrect: null,
            totalQuestions: null,
          }),
          hoja("e1", "b1", {
            id: "b",
            score: 10,
            totalCorrect: 10,
            totalQuestions: 20,
          }),
        ],
      }),
    );

    // Gana la de id mayor ("b"), que tiene nota → no sale.
    expect(r.filas).toHaveLength(0);
  });

  it("el estudiante retirado no se lista, pero cuenta para el número de lista", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1", { activo: false }), estudiante("e2")],
        cuadernillos: [cuadernillo("b1")],
      }),
    );

    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]?.studentId).toBe("e2");
    // "e1" ocupa el lugar 1 en la lista impresa (por apellido).
    expect(r.filas[0]?.item).toBe(2);
  });

  it("una fila por cuadernillo pendiente del mismo estudiante", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1"), cuadernillo("b2")],
      }),
    );

    expect(r.filas).toHaveLength(2);
    expect(r.filas.map((f) => f.cuadernilloId)).toEqual(["b1", "b2"]);
    expect(r.resumen.total).toBe(2);
  });

  it("el resumen cuenta cada motivo", () => {
    const r = consolidarPendientes(
      input({
        estudiantes: [estudiante("e1"), estudiante("e2"), estudiante("e3")],
        cuadernillos: [cuadernillo("b1")],
        hojas: [
          hoja("e2", "b1", {
            score: null,
            totalCorrect: null,
            totalQuestions: null,
          }),
          hoja("e3", "b1", {
            score: 0,
            totalCorrect: 0,
            totalQuestions: 20,
            marcadas: 0,
            totalRespuestas: 20,
          }),
        ],
      }),
    );

    expect(r.resumen).toEqual({ sinHoja: 1, sinCalificar: 1, sinMarcar: 1, total: 3 });
  });
});

// ========== use case ==========

const OPCIONES: OpcionesPruebaGrupo = {
  pruebas: [
    {
      id: "p-2026",
      name: "2026-2",
      academicYearId: "y26",
      year: 2026,
      isCurrent: true,
      yearIsCurrent: true,
    },
    {
      id: "p-2025",
      name: "2025-4",
      academicYearId: "y25",
      year: 2025,
      isCurrent: true,
      yearIsCurrent: false,
    },
  ],
  grupos: [
    { id: "g-1001", name: "1001", courseName: "10", academicYearId: "y26" },
    { id: "g-1101", name: "1101", courseName: "11", academicYearId: "y26" },
  ],
};

function datos(over: Partial<DatosPendientes> = {}): DatosPendientes {
  return {
    prueba: { id: "p-2026", name: "2026-2", year: 2026, academicYearId: "y26" },
    grupo: {
      id: "g-1001",
      name: "1001",
      courseName: "10",
      courseId: "c10",
      academicYearId: "y26",
    },
    estudiantes: [],
    cuadernillos: [],
    hojas: [],
    ...over,
  };
}

class ReaderFake implements PendientesCalificacionReader {
  opcionesPedidas: (string[] | undefined)[] = [];
  datosPedidos: [string, string][] = [];
  cargar: DatosPendientes | null = datos();
  /** Datos que devuelve `listPendientesDePrueba` (uno por grupo). */
  porGrupo: DatosPendientes[] = [];
  pruebaPedida: [string, string[] | undefined][] = [];
  async listOpciones(_i: string, courseIds?: string[]) {
    this.opcionesPedidas.push(courseIds);
    return courseIds
      ? {
          ...OPCIONES,
          grupos: OPCIONES.grupos.filter((g) => courseIds.includes(`c${g.courseName}`)),
        }
      : OPCIONES;
  }
  async cargarDatos(_i: string, periodId: string, groupId: string) {
    this.datosPedidos.push([periodId, groupId]);
    return this.cargar;
  }
  async listPendientesDePrueba(_i: string, periodId: string, courseIds?: string[]) {
    this.pruebaPedida.push([periodId, courseIds]);
    return { periodo: { id: periodId, name: "2026-2" }, datos: this.porGrupo };
  }
}

class ScopeFake {
  constructor(private readonly courseIds: string[]) {}
  async listAssignedCourseIds() {
    return this.courseIds;
  }
}

let reader: ReaderFake;
let uc: ListPendientesCalificacion;

beforeEach(() => {
  reader = new ReaderFake();
  uc = new ListPendientesCalificacion(reader, new ScopeFake(["c10"]));
});

describe("ListPendientesCalificacion - acceso", () => {
  it("el docente no tiene acceso", async () => {
    const r = await uc.execute({ actor: docente });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("el master ve todos los grupos (sin recorte)", async () => {
    const r = await uc.execute({ actor: master });
    expect(r.ok).toBe(true);
    expect(reader.opcionesPedidas).toEqual([undefined]);
  });

  it("el líder queda acotado a sus grados", async () => {
    const r = await uc.execute({ actor: lider });
    expect(reader.opcionesPedidas).toEqual([["c10"]]);
    if (r.ok) expect(r.value.opciones.grupos.map((g) => g.id)).toEqual(["g-1001"]);
  });

  it("el líder que pide un grupo fuera de su alcance recibe FORBIDDEN y no se cargan datos", async () => {
    const r = await uc.execute({ actor: lider, periodId: "p-2026", groupId: "g-1101" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.informe).toBeNull();
      expect(r.value.error?.code).toBe("FORBIDDEN");
      expect(r.value.opciones.grupos).toHaveLength(1);
    }
    expect(reader.datosPedidos).toEqual([]);
  });
});

describe("ListPendientesCalificacion - selección", () => {
  it("sin prueba preselecciona la actual del año actual; sin grupo no hay informe", async () => {
    const r = await uc.execute({ actor: master });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.seleccion).toEqual({ periodId: "p-2026", groupId: null });
      expect(r.value.informe).toBeNull();
      expect(r.value.error).toBeNull();
    }
  });

  it("con prueba y grupo arma el informe", async () => {
    const r = await uc.execute({ actor: master, periodId: "p-2026", groupId: "g-1001" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.informe?.grupo.name).toBe("1001");
      expect(r.value.error).toBeNull();
    }
    expect(reader.datosPedidos).toEqual([["p-2026", "g-1001"]]);
  });

  it("un grupo de otro año académico que la prueba da VALIDATION", async () => {
    reader.cargar = datos({
      prueba: { id: "p-2025", name: "2025-4", year: 2025, academicYearId: "y25" },
    });
    const r = await uc.execute({ actor: master, periodId: "p-2025", groupId: "g-1001" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.informe).toBeNull();
      expect(r.value.error?.code).toBe("VALIDATION");
    }
  });

  it("una prueba que no existe da NOT_FOUND", async () => {
    const r = await uc.execute({ actor: master, periodId: "p-x", groupId: "g-1001" });
    if (r.ok) expect(r.value.error?.code).toBe("NOT_FOUND");
  });

  it("un grupo de otra institución (master) da NOT_FOUND", async () => {
    const r = await uc.execute({ actor: master, periodId: "p-2026", groupId: "g-ajeno" });
    if (r.ok) expect(r.value.error?.code).toBe("NOT_FOUND");
    expect(reader.datosPedidos).toEqual([]);
  });
});

describe("ListPendientesDePrueba - Excel de todos los grados", () => {
  let ucPrueba: ListPendientesDePrueba;

  beforeEach(() => {
    ucPrueba = new ListPendientesDePrueba(reader, new ScopeFake(["c10"]));
  });

  it("el docente no tiene acceso", async () => {
    const r = await ucPrueba.execute({ actor: docente, periodId: "p-2026" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("el master pide la prueba sin acotar por grados", async () => {
    reader.porGrupo = [
      datos({
        grupo: {
          id: "g-1001",
          name: "1001",
          courseName: "10",
          courseId: "c10",
          academicYearId: "y26",
        },
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
      }),
    ];

    const r = await ucPrueba.execute({ actor: master, periodId: "p-2026" });
    expect(r.ok).toBe(true);
    expect(reader.pruebaPedida).toEqual([["p-2026", undefined]]);
    if (r.ok) {
      expect(r.value.periodo.name).toBe("2026-2");
      expect(r.value.filas).toHaveLength(1);
      expect(r.value.filas[0]?.motivo).toBe("sin-hoja");
      expect(r.value.resumen).toEqual({
        sinHoja: 1,
        sinCalificar: 0,
        sinMarcar: 0,
        total: 1,
      });
    }
  });

  it("el líder queda acotado a sus grados", async () => {
    await ucPrueba.execute({ actor: lider, periodId: "p-2026" });
    expect(reader.pruebaPedida).toEqual([["p-2026", ["c10"]]]);
  });

  it("concatena las filas de todos los grupos en una sola lista", async () => {
    reader.porGrupo = [
      datos({
        grupo: {
          id: "g-1001",
          name: "1001",
          courseName: "10",
          courseId: "c10",
          academicYearId: "y26",
        },
        estudiantes: [estudiante("e1")],
        cuadernillos: [cuadernillo("b1")],
      }),
      datos({
        grupo: {
          id: "g-1101",
          name: "1101",
          courseName: "11",
          courseId: "c11",
          academicYearId: "y26",
        },
        estudiantes: [estudiante("e2", { courseId: "c11" })],
        cuadernillos: [cuadernillo("b2", { courseId: "c11" })],
      }),
    ];

    const r = await ucPrueba.execute({ actor: master, periodId: "p-2026" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.filas.map((f) => f.groupName)).toEqual(["1001", "1101"]);
      expect(r.value.filas.map((f) => f.courseName)).toEqual(["10", "11"]);
      expect(r.value.resumen.total).toBe(2);
    }
  });

  it("sin datos devuelve el panorama vacío, sin error", async () => {
    reader.porGrupo = [];
    const r = await ucPrueba.execute({ actor: master, periodId: "p-2026" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.filas).toEqual([]);
      expect(r.value.resumen.total).toBe(0);
    }
  });
});
