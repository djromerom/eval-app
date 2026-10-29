/**
 * Tests del desglose por asignatura. Lo que se fija es la invariante de la
 * vista — correctas + incorrectas + faltantes === total — y dónde cae cada
 * caso raro, que es lo que una maqueta de tres columnas no dice.
 */
import { describe, expect, it } from "vitest";
import {
  resumirPorAsignatura,
  totalizar,
  type RespuestaParaResumen,
} from "@/modules/consultas/domain/queries/calificaciones/resumen-asignaturas";

function r(over: Partial<RespuestaParaResumen> = {}): RespuestaParaResumen {
  return {
    subjectName: "Biología",
    orden: 1,
    selectedKey: "A",
    isCorrect: true,
    isAmbiguous: false,
    ...over,
  };
}

describe("resumirPorAsignatura", () => {
  it("agrupa y cuenta por materia", () => {
    const filas = resumirPorAsignatura([
      r({ isCorrect: true }),
      r({ isCorrect: false, selectedKey: "B" }),
      r({ isCorrect: false, selectedKey: null }), // en blanco
      r({ subjectName: "Física", orden: 2, isCorrect: true }),
    ]);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      subjectName: "Biología",
      correctas: 1,
      incorrectas: 1,
      faltantes: 1,
      total: 3,
    });
    expect(filas[1]!.subjectName).toBe("Física");
  });

  it("una marca múltiple es incorrecta, no faltante", () => {
    // Marcó: no es "faltando". No acertó: no es correcta.
    const [f] = resumirPorAsignatura([
      r({ isCorrect: false, selectedKey: null, isAmbiguous: true }),
    ]);
    expect(f).toMatchObject({ correctas: 0, incorrectas: 1, faltantes: 0, total: 1 });
  });

  it("mantiene la invariante correctas + incorrectas + faltantes = total", () => {
    const filas = resumirPorAsignatura([
      r({ isCorrect: true }),
      r({ isCorrect: false, selectedKey: "C" }),
      r({ isCorrect: null, selectedKey: null }),
      r({ isCorrect: false, selectedKey: null, isAmbiguous: true }),
    ]);
    for (const f of filas) {
      expect(f.correctas + f.incorrectas + f.faltantes).toBe(f.total);
    }
  });

  it("aplica el puntaje con piso de 3", () => {
    const [f] = resumirPorAsignatura(
      Array.from({ length: 10 }, (_, i) => r({ isCorrect: i === 0, selectedKey: "A" })),
    );
    expect(f!.correctas).toBe(1); // 1/10 -> crudo 1.0
    expect(f!.puntaje).toBe(3); // piso
  });

  it("ordena por el orden del cuadernillo, y lo que no tiene orden va al final", () => {
    const filas = resumirPorAsignatura([
      r({ subjectName: "Zoología", orden: 3 }),
      r({ subjectName: "Sin orden", orden: null }),
      r({ subjectName: "Álgebra", orden: 1 }),
    ]);
    expect(filas.map((f) => f.subjectName)).toEqual(["Álgebra", "Zoología", "Sin orden"]);
  });

  it("las respuestas sin asignatura no se pierden, se agrupan aparte", () => {
    const filas = resumirPorAsignatura([r({ subjectName: null }), r({ subjectName: "   " })]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ subjectName: "Sin asignatura", total: 2 });
  });

  it("sin respuestas devuelve una lista vacía", () => {
    expect(resumirPorAsignatura([])).toEqual([]);
  });
});

describe("totalizar", () => {
  it("suma las materias y recalcula el puntaje sobre el total", () => {
    const filas = resumirPorAsignatura([
      r({ subjectName: "A", orden: 1, isCorrect: true }),
      r({ subjectName: "A", orden: 1, isCorrect: false, selectedKey: "B" }),
      r({ subjectName: "B", orden: 2, isCorrect: true }),
      r({ subjectName: "B", orden: 2, isCorrect: true }),
    ]);
    const t = totalizar(filas);
    expect(t).toMatchObject({ correctas: 3, incorrectas: 1, faltantes: 0, total: 4 });
    expect(t.puntaje).toBe(7.5); // 10 * 3/4
  });

  it("el total no es el promedio de los puntajes por materia", () => {
    // Materias de distinto tamaño: promediar notas daría otro número.
    const filas = resumirPorAsignatura([
      ...Array.from({ length: 9 }, () => r({ subjectName: "Grande", orden: 1, isCorrect: true })),
      r({ subjectName: "Chica", orden: 2, isCorrect: false, selectedKey: "B" }),
    ]);
    expect(totalizar(filas).puntaje).toBe(9); // 10 * 9/10, no el promedio (10 y 3) = 6.5
  });
});

describe("resumirPorAsignatura - preguntas inhabilitadas del cuadernillo", () => {
  it("una inhabilitada no entra en ningún conteo ni en el puntaje", () => {
    const filas = resumirPorAsignatura([
      r({ isCorrect: true }),
      r({ isCorrect: false, selectedKey: "B" }),
      r({ isCorrect: true, disabled: true }), // acertada pero no cuenta
      r({ isCorrect: false, selectedKey: null, disabled: true }), // en blanco, no cuenta
    ]);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ correctas: 1, incorrectas: 1, faltantes: 0, total: 2 });
    expect(filas[0]!.puntaje).toBe(5); // 10 * 1/2
  });

  it("mantiene la invariante con inhabilitadas", () => {
    const filas = resumirPorAsignatura([
      r({ isCorrect: true }),
      r({ isCorrect: false, selectedKey: null, isAmbiguous: true, disabled: true }),
      r({ isCorrect: null, selectedKey: null }),
    ]);
    for (const f of filas) {
      expect(f.correctas + f.incorrectas + f.faltantes).toBe(f.total);
    }
  });

  it("una materia con todas sus preguntas inhabilitadas no aparece", () => {
    const filas = resumirPorAsignatura([
      r({ subjectName: "Biología", orden: 1, isCorrect: true }),
      r({ subjectName: "Física", orden: 2, isCorrect: true, disabled: true }),
    ]);
    expect(filas.map((f) => f.subjectName)).toEqual(["Biología"]);
    expect(totalizar(filas)).toMatchObject({ correctas: 1, total: 1 });
  });

  it("disabled: false se trata igual que ausente", () => {
    const filas = resumirPorAsignatura([r({ disabled: false }), r()]);
    expect(filas[0]!.total).toBe(2);
  });
});
