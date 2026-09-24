/**
 * Consolidación del Informe detallado por grupo. Fija las reglas acordadas:
 * suma por asignatura entre cuadernillos, hoja vigente (la última), pendientes
 * vacías, inhabilitadas por cuadernillo, ITEM = número de lista impreso,
 * columnas en orden de cuadernillo/ítem y etiqueta sigla-o-nombre.
 */
import { describe, expect, it } from "vitest";
import {
  type ConsolidarInformeGrupoInput,
  type CuadernilloInforme,
  type EstudianteGrupo,
  type HojaInforme,
  type RespuestaInforme,
  claveInhabilitada,
  consolidarInformeGrupo,
  hojasVigentes,
} from "@/modules/consultas/domain/queries/informe-grupo/consolidar";
import { pruebaPorDefecto } from "@/modules/consultas/domain/queries/informe-grupo/informe-grupo";

const BIO = { id: "s-bio", name: "Biología", code: "BIO", shortName: "BIO" };
const FIS = { id: "s-fis", name: "Física", code: "FIS", shortName: "FIS" };
const ING = { id: "s-ing", name: "Inglés", code: "ING", shortName: null };

function est(id: string, lastName1: string, activo = true): EstudianteGrupo {
  return {
    id,
    code: `C-${id}`,
    lastName1,
    lastName2: "",
    firstName1: "Ana",
    firstName2: "",
    activo,
  };
}

function cuad(
  id: string,
  bookletNumber: number | null,
  items: { id: string; order: number; subject: CuadernilloInforme["items"][number]["subject"] }[],
): CuadernilloInforme {
  return { id, name: `Cuadernillo ${id}`, bookletNumber, createdAt: new Date("2026-09-01"), items };
}

function hoja(
  id: string,
  bundleId: string,
  studentId: string,
  t: number,
  calificada = true,
): HojaInforme {
  return { id, bundleId, studentId, updatedAt: new Date(t), calificada };
}

/** `n` respuestas de una hoja/ítem, las primeras `correctas` acertadas. */
function resp(
  answerSheetId: string,
  bundleItemId: string,
  n: number,
  correctas: number,
  prefijo = bundleItemId,
): RespuestaInforme[] {
  return Array.from({ length: n }, (_, i) => ({
    answerSheetId,
    bundleItemId,
    questionId: `${prefijo}-q${i + 1}`,
    isCorrect: i < correctas,
  }));
}

function base(over: Partial<ConsolidarInformeGrupoInput> = {}): ConsolidarInformeGrupoInput {
  return {
    prueba: { id: "p1", name: "2026-2" },
    grupo: { id: "g1", name: "1001", courseName: "10" },
    estudiantes: [est("e1", "Álvarez")],
    cuadernillos: [cuad("b1", 1, [{ id: "i-bio", order: 1, subject: BIO }])],
    hojas: [hoja("h1", "b1", "e1", 1)],
    respuestas: resp("h1", "i-bio", 10, 8),
    inhabilitadas: new Set(),
    ...over,
  };
}

describe("consolidarInformeGrupo - puntaje", () => {
  it("calcula el puntaje 0-10 por asignatura (8/10 → 8.0)", () => {
    const inf = consolidarInformeGrupo(base());
    expect(inf.filas[0]!.puntajes["s-bio"]).toEqual({ puntaje: 8, correctas: 8, total: 10 });
  });

  it("aplica el piso de 3", () => {
    const inf = consolidarInformeGrupo(base({ respuestas: resp("h1", "i-bio", 10, 1) }));
    expect(inf.filas[0]!.puntajes["s-bio"]!.puntaje).toBe(3);
  });

  it("consolida dos cuadernillos del grado y suma la misma asignatura (no promedia)", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("b1", 1, [{ id: "i1-bio", order: 1, subject: BIO }]),
          cuad("b2", 2, [
            { id: "i2-fis", order: 1, subject: FIS },
            { id: "i2-bio", order: 2, subject: BIO },
          ]),
        ],
        hojas: [hoja("h1", "b1", "e1", 1), hoja("h2", "b2", "e1", 1)],
        respuestas: [
          ...resp("h1", "i1-bio", 10, 0), // 0/10
          ...resp("h2", "i2-bio", 10, 10), // 10/10
          ...resp("h2", "i2-fis", 4, 2),
        ],
      }),
    );
    // Sumado: 10/20 → 5.0. Promediando puntajes con piso daría (3 + 10) / 2 = 6.5.
    expect(inf.filas[0]!.puntajes["s-bio"]).toEqual({ puntaje: 5, correctas: 10, total: 20 });
    expect(inf.filas[0]!.puntajes["s-fis"]!.puntaje).toBe(5);
    expect(inf.cuadernillos.map((c) => c.id)).toEqual(["b1", "b2"]);
  });

  it("las marcas múltiples/blancos (isCorrect null o false) cuentan en el total", () => {
    const inf = consolidarInformeGrupo(
      base({
        respuestas: [
          { answerSheetId: "h1", bundleItemId: "i-bio", questionId: "q1", isCorrect: true },
          { answerSheetId: "h1", bundleItemId: "i-bio", questionId: "q2", isCorrect: null },
        ],
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toMatchObject({ correctas: 1, total: 2 });
  });
});

describe("consolidarInformeGrupo - hojas", () => {
  it("toma la hoja más reciente por estudiante y cuadernillo", () => {
    const inf = consolidarInformeGrupo(
      base({
        hojas: [hoja("vieja", "b1", "e1", 1), hoja("nueva", "b1", "e1", 2)],
        respuestas: [...resp("vieja", "i-bio", 10, 2), ...resp("nueva", "i-bio", 10, 9)],
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toMatchObject({ correctas: 9, total: 10 });
  });

  it("si la hoja vigente está pendiente, la celda queda vacía (no usa la vieja)", () => {
    const inf = consolidarInformeGrupo(
      base({
        hojas: [hoja("vieja", "b1", "e1", 1), hoja("pendiente", "b1", "e1", 2, false)],
        respuestas: resp("vieja", "i-bio", 10, 8),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toBeNull();
  });

  it("estudiante sin hoja: fila con celdas vacías", () => {
    const inf = consolidarInformeGrupo(
      base({ estudiantes: [est("e1", "Álvarez"), est("e2", "Bernal")] }),
    );
    const e2 = inf.filas.find((f) => f.studentId === "e2")!;
    expect(e2.puntajes["s-bio"]).toBeNull();
  });

  it("ignora respuestas sin bundleItemId (hojas anteriores al Sprint 4)", () => {
    const inf = consolidarInformeGrupo(
      base({
        respuestas: [
          ...resp("h1", "i-bio", 2, 2),
          { answerSheetId: "h1", bundleItemId: null, questionId: "x", isCorrect: false },
        ],
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toMatchObject({ correctas: 2, total: 2 });
  });

  it("hojasVigentes desempata por id cuando updatedAt es igual", () => {
    const v = hojasVigentes([hoja("a", "b1", "e1", 5), hoja("b", "b1", "e1", 5)]);
    expect(v.map((h) => h.id)).toEqual(["b"]);
  });
});

describe("consolidarInformeGrupo - asignatura en dos cuadernillos con una hoja pendiente", () => {
  const dosCuadernillos = [
    cuad("b1", 1, [{ id: "i1-bio", order: 1, subject: BIO }]),
    cuad("b2", 2, [
      { id: "i2-bio", order: 1, subject: BIO },
      { id: "i2-fis", order: 2, subject: FIS },
    ]),
  ];

  it("la celda queda vacía (no muestra el parcial del otro cuadernillo como nota final)", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: dosCuadernillos,
        hojas: [hoja("h1", "b1", "e1", 1), hoja("h2", "b2", "e1", 1, false)],
        respuestas: resp("h1", "i1-bio", 20, 20),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toBeNull();
    expect(inf.filas[0]!.puntajes["s-fis"]).toBeNull();
  });

  it("una asignatura que solo está en el cuadernillo calificado sí muestra su nota", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("b1", 1, [{ id: "i1-ing", order: 1, subject: ING }]),
          cuad("b2", 2, [{ id: "i2-fis", order: 1, subject: FIS }]),
        ],
        hojas: [hoja("h1", "b1", "e1", 1), hoja("h2", "b2", "e1", 1, false)],
        respuestas: resp("h1", "i1-ing", 10, 7),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-ing"]!.puntaje).toBe(7);
    expect(inf.filas[0]!.puntajes["s-fis"]).toBeNull();
  });

  it("la hoja pendiente de OTRO estudiante no afecta a este", () => {
    const inf = consolidarInformeGrupo(
      base({
        estudiantes: [est("e1", "Álvarez"), est("e2", "Bernal")],
        cuadernillos: dosCuadernillos,
        hojas: [
          hoja("h1", "b1", "e1", 1),
          hoja("h2", "b2", "e1", 1),
          hoja("h3", "b2", "e2", 1, false),
        ],
        respuestas: [...resp("h1", "i1-bio", 10, 10), ...resp("h2", "i2-bio", 10, 0)],
      }),
    );
    expect(inf.filas.find((f) => f.studentId === "e1")!.puntajes["s-bio"]).toMatchObject({
      correctas: 10,
      total: 20,
    });
  });
});

describe("consolidarInformeGrupo - inhabilitadas", () => {
  it("no cuentan, con clave por cuadernillo", () => {
    const inf = consolidarInformeGrupo(
      base({
        respuestas: resp("h1", "i-bio", 10, 10),
        inhabilitadas: new Set([
          claveInhabilitada("b1", "i-bio-q1"),
          claveInhabilitada("b1", "i-bio-q2"),
        ]),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toEqual({ puntaje: 10, correctas: 8, total: 8 });
  });

  it("usa el cuadernillo del ítem para la clave, no el de la hoja", () => {
    // La hoja quedó en el lote de b1, pero sus ítems son de b2 (papel de otro
    // cuadernillo). La inhabilitación vive en b2.
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("b1", 1, [{ id: "i1-bio", order: 1, subject: BIO }]),
          cuad("b2", 2, [{ id: "i2-bio", order: 1, subject: BIO }]),
        ],
        hojas: [hoja("h1", "b1", "e1", 1)],
        respuestas: resp("h1", "i2-bio", 4, 4),
        inhabilitadas: new Set([claveInhabilitada("b2", "i2-bio-q1")]),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toMatchObject({ correctas: 3, total: 3 });
  });

  it("una pregunta inhabilitada en OTRO cuadernillo sí cuenta en este", () => {
    const inf = consolidarInformeGrupo(
      base({
        respuestas: resp("h1", "i-bio", 10, 10),
        inhabilitadas: new Set([claveInhabilitada("otro", "i-bio-q1")]),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]!.total).toBe(10);
  });

  it("si todas las preguntas de la asignatura están inhabilitadas, la celda queda vacía", () => {
    const inf = consolidarInformeGrupo(
      base({
        respuestas: resp("h1", "i-bio", 2, 2),
        inhabilitadas: new Set([
          claveInhabilitada("b1", "i-bio-q1"),
          claveInhabilitada("b1", "i-bio-q2"),
        ]),
      }),
    );
    expect(inf.filas[0]!.puntajes["s-bio"]).toBeNull();
  });
});

describe("consolidarInformeGrupo - columnas y filas", () => {
  it("columnas en orden de cuadernillo (número) y dentro por orden de formulación, sin repetir", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("b2", 2, [
            { id: "i2b", order: 2, subject: BIO },
            { id: "i2a", order: 1, subject: ING },
          ]),
          cuad("b1", 1, [
            { id: "i1a", order: 1, subject: FIS },
            { id: "i1b", order: 2, subject: BIO },
          ]),
        ],
        hojas: [],
        respuestas: [],
      }),
    );
    expect(inf.asignaturas.map((a) => a.subjectId)).toEqual(["s-fis", "s-bio", "s-ing"]);
  });

  it("cuadernillo sin número va al final", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("sin", null, [{ id: "x", order: 1, subject: ING }]),
          cuad("b1", 1, [{ id: "y", order: 1, subject: FIS }]),
        ],
        hojas: [],
        respuestas: [],
      }),
    );
    expect(inf.cuadernillos.map((c) => c.id)).toEqual(["b1", "sin"]);
  });

  it("la etiqueta es la sigla; sin sigla, el nombre completo", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("b1", 1, [
            { id: "i1", order: 1, subject: BIO },
            { id: "i2", order: 2, subject: ING },
            {
              id: "i3",
              order: 3,
              subject: { id: "s-x", name: "Ética", code: "ETI", shortName: "   " },
            },
          ]),
        ],
      }),
    );
    expect(inf.asignaturas.map((a) => a.etiqueta)).toEqual(["BIO", "Inglés", "Ética"]);
  });

  it("dos asignaturas con la misma etiqueta se desambiguan con el código", () => {
    const inf = consolidarInformeGrupo(
      base({
        cuadernillos: [
          cuad("b1", 1, [
            {
              id: "i1",
              order: 1,
              subject: { id: "s-mat-g", name: "Matemáticas", code: "MAT", shortName: null },
            },
            {
              id: "i2",
              order: 2,
              subject: { id: "s-mat-p", name: "Matemáticas", code: "MAT10", shortName: null },
            },
            { id: "i3", order: 3, subject: BIO },
          ]),
        ],
        hojas: [],
        respuestas: [],
      }),
    );
    expect(inf.asignaturas.map((a) => a.etiqueta)).toEqual([
      "Matemáticas (MAT)",
      "Matemáticas (MAT10)",
      "BIO",
    ]);
  });

  it("ITEM = número de lista impreso: cuenta a los retirados pero no los lista", () => {
    const inf = consolidarInformeGrupo(
      base({
        estudiantes: [est("e1", "Álvarez"), est("e2", "Bernal", false), est("e3", "Castro")],
        hojas: [],
        respuestas: [],
      }),
    );
    expect(inf.filas.map((f) => [f.item, f.studentId])).toEqual([
      [1, "e1"],
      [3, "e3"],
    ]);
  });

  it("el nombre sale en formato APELLIDOS, NOMBRES", () => {
    const inf = consolidarInformeGrupo(base());
    expect(inf.filas[0]!.nombre).toBe("Álvarez, Ana");
  });
});

describe("pruebaPorDefecto", () => {
  const p = (id: string, isCurrent: boolean, yearIsCurrent: boolean) => ({
    id,
    name: id,
    academicYearId: "y",
    year: 2026,
    isCurrent,
    yearIsCurrent,
  });

  it("prefiere la actual del año actual", () => {
    expect(pruebaPorDefecto([p("a", true, false), p("b", true, true)])!.id).toBe("b");
  });
  it("si no, la actual de cualquier año; si no, la primera", () => {
    expect(pruebaPorDefecto([p("a", false, false), p("b", true, false)])!.id).toBe("b");
    expect(pruebaPorDefecto([p("a", false, false)])!.id).toBe("a");
    expect(pruebaPorDefecto([])).toBeNull();
  });
});
