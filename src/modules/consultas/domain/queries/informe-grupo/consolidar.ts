/**
 * Consolidación pura del Informe detallado por grupo. Ver las reglas en
 * `informe-grupo.ts`. Sin Prisma: recibe los datos ya cargados y devuelve el
 * informe, así que se prueba entera en memoria.
 */
import { listPositionByName } from "@/modules/students/domain/student";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";
import { calcularPuntaje } from "../calificaciones/puntaje";
import type { AsignaturaColumna, FilaInformeGrupo, InformeGrupo } from "./informe-grupo";

export interface EstudianteGrupo {
  id: string;
  code: string;
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  /** `isActive && !deletedAt`. Los inactivos cuentan para el número de lista
   *  pero no se listan. */
  activo: boolean;
}

export interface CuadernilloInforme {
  id: string;
  name: string;
  bookletNumber: number | null;
  createdAt: Date;
  /** Formulaciones del cuadernillo (EvaluationBundleItem). */
  items: {
    id: string;
    order: number;
    subject: { id: string; name: string; code: string; shortName: string | null };
  }[];
}

export interface HojaInforme {
  id: string;
  bundleId: string;
  studentId: string;
  updatedAt: Date;
  /** Tiene nota (`score` no nulo). Sin nota = pendiente o en reproceso. */
  calificada: boolean;
}

export interface RespuestaInforme {
  answerSheetId: string;
  bundleItemId: string | null;
  questionId: string;
  isCorrect: boolean | null;
  /** Necesario para distinguir blanco (`"BLANCO" | null`) de incorrecta.
   *  Sin este campo, una marca con `isCorrect=false` se confunde con un
   *  blanco y la columna "# incorrecta" del PDF quedaría desfasada. */
  selectedKey: string | null;
}

export interface ConsolidarInformeGrupoInput {
  prueba: { id: string; name: string; year: number };
  grupo: { id: string; name: string; courseName: string };
  estudiantes: readonly EstudianteGrupo[];
  cuadernillos: readonly CuadernilloInforme[];
  hojas: readonly HojaInforme[];
  respuestas: readonly RespuestaInforme[];
  /** Preguntas inhabilitadas, con clave `${bundleId}|${questionId}`. La clave
   *  incluye el cuadernillo porque una formulación puede estar en dos
   *  cuadernillos con inhabilitaciones distintas. */
  inhabilitadas: ReadonlySet<string>;
}

/** Clave del set de inhabilitadas. */
export function claveInhabilitada(bundleId: string, questionId: string): string {
  return `${bundleId}|${questionId}`;
}

/** Orden de los cuadernillos en el informe: número de cuadernillo (sin número
 *  al final), luego fecha de creación, luego id para que sea estable. */
export function ordenarCuadernillos<T extends CuadernilloInforme>(cuadernillos: readonly T[]): T[] {
  return [...cuadernillos].sort(
    (a, b) =>
      (a.bookletNumber ?? Number.MAX_SAFE_INTEGER) - (b.bookletNumber ?? Number.MAX_SAFE_INTEGER) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

/** Hoja vigente por (estudiante, cuadernillo): la de `updatedAt` más reciente,
 *  la misma regla que la consulta de calificaciones. Las usa también el
 *  fetcher para traer solo las respuestas que van a contar. */
export function hojasVigentes<T extends HojaInforme>(hojas: readonly T[]): T[] {
  const porClave = new Map<string, T>();
  for (const h of hojas) {
    const clave = `${h.studentId}|${h.bundleId}`;
    const actual = porClave.get(clave);
    if (
      !actual ||
      h.updatedAt.getTime() > actual.updatedAt.getTime() ||
      (h.updatedAt.getTime() === actual.updatedAt.getTime() && h.id > actual.id)
    ) {
      porClave.set(clave, h);
    }
  }
  return [...porClave.values()];
}

export function consolidarInformeGrupo(input: ConsolidarInformeGrupoInput): InformeGrupo {
  const cuadernillos = ordenarCuadernillos(input.cuadernillos);

  // Columnas en orden de cuadernillo → formulación, sin repetir asignatura.
  const asignaturas: (AsignaturaColumna & { code: string })[] = [];
  const vistas = new Set<string>();
  /** Ítem → su cuadernillo y asignatura. La clave de inhabilitadas usa el
   *  cuadernillo del ÍTEM, que es donde vive la inhabilitación. */
  const itemInfo = new Map<string, { bundleId: string; subjectId: string }>();
  /** Asignaturas de cada cuadernillo, para saber qué celdas deja incompletas
   *  una hoja pendiente. */
  const subjectsPorCuadernillo = new Map<string, Set<string>>();
  for (const c of cuadernillos) {
    const delCuadernillo = new Set<string>();
    for (const it of [...c.items].sort((a, b) => a.order - b.order)) {
      itemInfo.set(it.id, { bundleId: c.id, subjectId: it.subject.id });
      delCuadernillo.add(it.subject.id);
      if (vistas.has(it.subject.id)) continue;
      vistas.add(it.subject.id);
      asignaturas.push({
        subjectId: it.subject.id,
        etiqueta: it.subject.shortName?.trim() || it.subject.name,
        nombre: it.subject.name,
        code: it.subject.code,
      });
    }
    subjectsPorCuadernillo.set(c.id, delCuadernillo);
  }
  // Dos asignaturas distintas con la misma etiqueta (homónimas, o la misma
  // sigla) serían dos encabezados idénticos: se desambiguan con el código.
  const repetidas = new Map<string, number>();
  for (const a of asignaturas) {
    const k = a.etiqueta.toLocaleLowerCase("es");
    repetidas.set(k, (repetidas.get(k) ?? 0) + 1);
  }
  for (const a of asignaturas) {
    if ((repetidas.get(a.etiqueta.toLocaleLowerCase("es")) ?? 0) > 1) {
      a.etiqueta = `${a.etiqueta} (${a.code})`;
    }
  }

  // Solo las hojas vigentes y calificadas aportan. Una hoja vigente SIN nota
  // (pendiente, en reproceso) deja incompletas las asignaturas de su
  // cuadernillo: esas celdas quedan vacías aunque otro cuadernillo sí tenga
  // nota, para no mostrar un parcial como si fuera la nota final.
  const cuadernillosDelInforme = new Set(cuadernillos.map((c) => c.id));
  const hojaAporta = new Map<string, { studentId: string }>();
  const incompletas = new Set<string>(); // `${studentId}|${subjectId}`
  for (const h of hojasVigentes(input.hojas)) {
    if (!cuadernillosDelInforme.has(h.bundleId)) continue;
    if (h.calificada) {
      hojaAporta.set(h.id, { studentId: h.studentId });
    } else {
      for (const s of subjectsPorCuadernillo.get(h.bundleId) ?? []) {
        incompletas.add(`${h.studentId}|${s}`);
      }
    }
  }

  // Suma por (estudiante, asignatura).
  const conteos = new Map<
    string,
    Map<string, { correctas: number; incorrectas: number; enBlanco: number; total: number }>
  >();
  for (const r of input.respuestas) {
    const hoja = hojaAporta.get(r.answerSheetId);
    if (!hoja) continue;
    if (!r.bundleItemId) continue; // hojas anteriores al Sprint 4: sin asignatura
    const item = itemInfo.get(r.bundleItemId);
    if (!item) continue;
    const subjectId = item.subjectId;
    if (input.inhabilitadas.has(claveInhabilitada(item.bundleId, r.questionId))) continue;

    let porSubject = conteos.get(hoja.studentId);
    if (!porSubject) {
      porSubject = new Map();
      conteos.set(hoja.studentId, porSubject);
    }
    const c = porSubject.get(subjectId) ?? {
      correctas: 0,
      incorrectas: 0,
      enBlanco: 0,
      total: 0,
    };
    c.total++;
    if (r.selectedKey === "BLANCO" || r.selectedKey === null) {
      c.enBlanco++;
    } else if (r.isCorrect === true) {
      c.correctas++;
    } else {
      c.incorrectas++;
    }
    porSubject.set(subjectId, c);
  }

  const filas: FilaInformeGrupo[] = input.estudiantes
    .filter((e) => e.activo)
    .map((e) => {
      const porSubject = conteos.get(e.id);
      const puntajes: FilaInformeGrupo["puntajes"] = {};
      for (const a of asignaturas) {
        if (incompletas.has(`${e.id}|${a.subjectId}`)) {
          puntajes[a.subjectId] = null;
          continue;
        }
        const c = porSubject?.get(a.subjectId);
        const puntaje = c ? calcularPuntaje(c.correctas, c.total) : null;
        puntajes[a.subjectId] =
          c && puntaje !== null
            ? {
                puntaje,
                correctas: c.correctas,
                total: c.total,
                incorrectas: c.incorrectas,
                enBlanco: c.enBlanco,
              }
            : null;
      }
      return {
        item: listPositionByName(input.estudiantes, e.id),
        studentId: e.id,
        nombre: nombreCompleto(e),
        codigo: e.code,
        puntajes,
      };
    })
    .sort(
      (a, b) =>
        (a.item ?? Number.MAX_SAFE_INTEGER) - (b.item ?? Number.MAX_SAFE_INTEGER) ||
        a.nombre.localeCompare(b.nombre, "es"),
    );

  return {
    prueba: input.prueba,
    grupo: input.grupo,
    cuadernillos: cuadernillos.map((c) => ({ id: c.id, name: c.name })),
    asignaturas: asignaturas.map(({ code: _code, ...a }) => a),
    filas,
  };
}
