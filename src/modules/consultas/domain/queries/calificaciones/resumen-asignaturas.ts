/**
 * Desglose por asignatura de una hoja de respuestas.
 *
 * Una hoja de cuadernillo une varias formulaciones, y cada una es de una
 * asignatura distinta: 95 ítems pueden repartirse en 4 materias. Esta función
 * agrupa las respuestas y calcula, por materia, el mismo puntaje 0-10 con piso
 * que usa la consulta (`calcularPuntaje`).
 *
 * **Las marcas múltiples cuentan como incorrectas.** El estudiante marcó, así
 * que no es "faltando"; y no acertó, así que no es correcta. Es la única
 * ubicación que mantiene la invariante de la vista —
 * `correctas + incorrectas + faltantes === total` — sin inventar una cuarta
 * columna que la maqueta no tiene. Si algún día importa distinguirlas, el
 * dato está en `isAmbiguous` y se agrega una columna aparte.
 *
 * **Las preguntas inhabilitadas del cuadernillo no cuentan** (sprint Preguntas
 * inhabitadas, sep 2026): se saltan en todos los conteos, igual que en la nota
 * guardada de la hoja, para que el Total coincida con la consulta. Una materia
 * con todas sus preguntas inhabilitadas no aparece.
 */
import { calcularPuntaje } from "./puntaje";

export interface RespuestaParaResumen {
  /** Asignatura de la formulación a la que pertenece el ítem. */
  subjectName: string | null;
  /** `bundleItem.order`: define el orden en que se listan las materias, para
   *  que coincida con el orden del cuadernillo impreso. */
  orden: number | null;
  /** `null` = no marcó nada, o marcó varias (ver `isAmbiguous`). */
  selectedKey: string | null;
  isCorrect: boolean | null;
  isAmbiguous: boolean;
  /** Pregunta inhabilitada en el cuadernillo: no entra en ningún conteo. */
  disabled?: boolean;
}

export interface FilaAsignatura {
  subjectName: string;
  correctas: number;
  incorrectas: number;
  /** Ítems que el estudiante dejó en blanco. No incluye las marcas múltiples. */
  faltantes: number;
  total: number;
  /** Escala 0-10 con piso de 3. `null` si la materia no tiene ítems. */
  puntaje: number | null;
}

const SIN_ASIGNATURA = "Sin asignatura";

export function resumirPorAsignatura(
  respuestas: readonly RespuestaParaResumen[],
): FilaAsignatura[] {
  const acc = new Map<string, FilaAsignatura & { orden: number }>();

  for (const r of respuestas) {
    if (r.disabled === true) continue;
    const nombre = r.subjectName?.trim() || SIN_ASIGNATURA;
    const fila =
      acc.get(nombre) ??
      ({
        subjectName: nombre,
        correctas: 0,
        incorrectas: 0,
        faltantes: 0,
        total: 0,
        puntaje: null,
        // Las materias sin orden van al final, no al principio.
        orden: r.orden ?? Number.MAX_SAFE_INTEGER,
      } satisfies FilaAsignatura & { orden: number });

    fila.total++;
    if (r.isCorrect === true) fila.correctas++;
    else if (r.selectedKey === null && !r.isAmbiguous) fila.faltantes++;
    else fila.incorrectas++;

    acc.set(nombre, fila);
  }

  return [...acc.values()]
    .sort((a, b) => a.orden - b.orden || a.subjectName.localeCompare(b.subjectName, "es"))
    .map(({ orden: _orden, ...fila }) => ({
      ...fila,
      puntaje: calcularPuntaje(fila.correctas, fila.total),
    }));
}

/** Totales de la hoja completa, para el pie de la tabla. */
export function totalizar(filas: readonly FilaAsignatura[]): FilaAsignatura {
  const t = filas.reduce(
    (s, f) => ({
      correctas: s.correctas + f.correctas,
      incorrectas: s.incorrectas + f.incorrectas,
      faltantes: s.faltantes + f.faltantes,
      total: s.total + f.total,
    }),
    { correctas: 0, incorrectas: 0, faltantes: 0, total: 0 },
  );
  return { subjectName: "Total", ...t, puntaje: calcularPuntaje(t.correctas, t.total) };
}
