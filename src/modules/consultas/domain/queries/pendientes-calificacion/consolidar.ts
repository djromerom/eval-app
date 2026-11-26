/**
 * Consolidación pura de los "Pendientes de calificación". Sin Prisma: recibe
 * los datos ya cargados y devuelve el informe, así que se prueba entera en
 * memoria.
 *
 * Las reglas (acordadas con el docente, nov 2026):
 *
 *   - **Hoja vigente por (estudiante, cuadernillo)**: la de `updatedAt` más
 *     reciente, la misma regla que la consulta de calificaciones y el informe
 *     por grupo. Un reescaneo genera una hoja nueva para el mismo estudiante;
 *     sin deduplicar, el listado sería un historial y no un pendiente.
 *   - **Motivo**: primero si no hay hoja ("sin-hoja"), después si la hoja está
 *     sin puntaje ("sin-calificar"), y por último si la hoja tiene nota pero
 *     ninguna opción marcada ("sin-marcar"). Son excluyentes: una fila tiene
 *     un solo motivo.
 *   - **"Sin marcar" = cero respuestas con `selectedKey`**. No es "todo
 *     incorrecto": un estudiante que respondió y se equivocó no es un
 *     pendiente. `selectedKey` es `null` cuando el motor no vio marca
 *     (`BLANCO`) o vio varias (`MULTIPLE`), y el literal "BLANCO" se acepta
 *     por si quedó en datos viejos.
 *   - **A quién se le espera un cuadernillo**: a los del mismo grado que el
 *     estudiante, y solo a los cuadernillos de su tipo. El grado importa
 *     porque así se imprime (un cuadernillo es de un curso), y el tipo
 *     también: un cuadernillo "Especial" solo se le entrega a los estudiantes
 *     con ese tipo de cuadernillo, y un cuadernillo sin tipo se le entrega a
 *     todos. Un compendio sin curso (cross-grado) se le espera a todo el
 *     mundo, y un cuadernillo en DRAFT no se imprimió, así que nadie debe una
 *     hoja de él.
 *   - **Estudiantes**: solo los activos. Los retirados se los trae para
 *     calcular el número de lista (igual que la impresión), pero no se
 *     listan.
 *   - **Un grupo por consolidación**: el número de lista es la posición del
 *     estudiante dentro de SU grupo, así que la consolidación se corre por
 *     grupo. El Excel de "todos los grados" concatena las filas de cada grupo
 *     sin reordenar los números de lista.
 */
import { listPositionByName } from "@/modules/students/domain/student";
import { nombreCompleto } from "@/modules/students/domain/nombre-completo";
import { calcularPuntaje } from "../calificaciones/puntaje";
import type { FilaPendiente, MotivoPendiente, PendientesInforme } from "./pendiente";

export interface EstudiantePendiente {
  id: string;
  code: string;
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  /** `isActive && !deletedAt`. */
  activo: boolean;
  /** Tipo de cuadernillo del estudiante (`BookletType.id`). `null` = sin tipo. */
  bookletTypeId: string | null;
  /** Grado del estudiante: el curso de su grupo. */
  courseId: string;
}

export interface CuadernilloPendiente {
  id: string;
  name: string;
  /** Tipo de cuadernillo (`BookletType.id`). `null` = aplica a todos. */
  bookletTypeId: string | null;
  /** Siglas de las asignaturas que cubre el cuadernillo. */
  asignaturas: string[];
  /** Grado del cuadernillo (`Course.id`). `null` = compendio cross-grado: se
   *  le espera a todo el mundo. */
  courseId: string | null;
  /** `READY` = sellado y por lo tanto impreso. Un DRAFT no se imprimió. */
  listo: boolean;
}

export interface HojaPendiente {
  id: string;
  studentId: string;
  bundleId: string;
  updatedAt: Date;
  /** Tiene nota (`score` no nulo). Sin nota = pendiente o en reproceso. */
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  status: string;
  createdAt: Date;
  /** Respuestas con una opción marcada. */
  marcadas: number;
  /** Respuestas registradas en la hoja. */
  totalRespuestas: number;
}

export interface ConsolidarPendientesInput {
  prueba: { id: string; name: string; year: number; academicYearId: string };
  grupo: {
    id: string;
    name: string;
    courseName: string;
    courseId: string;
    academicYearId: string;
  };
  estudiantes: readonly EstudiantePendiente[];
  cuadernillos: readonly CuadernilloPendiente[];
  hojas: readonly HojaPendiente[];
}

/** Hoja vigente por (estudiante, cuadernillo): la de `updatedAt` más reciente,
 *  desempate por id para que el resultado no dependa del orden de la BD. */
export function hojaVigentePorCuadernillo(
  hojas: readonly HojaPendiente[],
): Map<string, HojaPendiente> {
  const porClave = new Map<string, HojaPendiente>();
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
  return porClave;
}

/** ¿Se le espera este cuadernillo a este estudiante? */
export function esperaCuadernillo(
  cuadernillo: CuadernilloPendiente,
  estudiante: EstudiantePendiente,
): boolean {
  if (!cuadernillo.listo) return false;
  // Un compendio sin curso (cross-grado) se le espera a todo el mundo; uno
  // con curso, solo a los estudiantes de ese grado.
  if (cuadernillo.courseId !== null && cuadernillo.courseId !== estudiante.courseId) return false;
  // Un cuadernillo sin tipo se imprime para todos los del grado; uno con tipo
  // solo para los estudiantes de ese tipo.
  return (
    cuadernillo.bookletTypeId === null || cuadernillo.bookletTypeId === estudiante.bookletTypeId
  );
}

export function consolidarPendientes(input: ConsolidarPendientesInput): PendientesInforme {
  const vigentes = hojaVigentePorCuadernillo(input.hojas);

  const filas: FilaPendiente[] = [];
  const resumen = { sinHoja: 0, sinCalificar: 0, sinMarcar: 0, total: 0 };

  for (const estudiante of input.estudiantes) {
    if (!estudiante.activo) continue;

    for (const cuadernillo of input.cuadernillos) {
      const hoja = vigentes.get(`${estudiante.id}|${cuadernillo.id}`);

      let motivo: MotivoPendiente | null = null;
      if (!hoja) {
        // Sin hoja solo es faltante si se le esperaba ese cuadernillo: si el
        // estudiante tiene hoja de un cuadernillo que no es suyo, esa hoja
        // se revisa por sus propios motivos.
        if (!esperaCuadernillo(cuadernillo, estudiante)) continue;
        motivo = "sin-hoja";
      } else if (hoja.score === null) {
        motivo = "sin-calificar";
      } else if (hoja.marcadas === 0) {
        motivo = "sin-marcar";
      }
      if (!motivo) continue;

      if (motivo === "sin-hoja") resumen.sinHoja++;
      else if (motivo === "sin-calificar") resumen.sinCalificar++;
      else resumen.sinMarcar++;
      resumen.total++;

      filas.push({
        item: listPositionByName(input.estudiantes, estudiante.id),
        studentId: estudiante.id,
        studentName: nombreCompleto(estudiante),
        studentCode: estudiante.code,
        courseName: input.grupo.courseName,
        groupName: input.grupo.name,
        cuadernilloId: cuadernillo.id,
        cuadernilloName: cuadernillo.name,
        asignaturas: cuadernillo.asignaturas.join(", "),
        motivo,
        estadoHoja: hoja?.status ?? null,
        marcadas: hoja?.marcadas ?? null,
        totalRespuestas: hoja?.totalRespuestas ?? null,
        puntaje: hoja ? calcularPuntaje(hoja.totalCorrect, hoja.totalQuestions) : null,
        escaneadaAt: hoja?.createdAt ?? null,
      });
    }
  }

  // Orden: por número de lista (el que va impreso en la hoja) y, dentro del
  // mismo estudiante, por el orden de los cuadernillos.
  const ordenCuadernillo = new Map(input.cuadernillos.map((c, i) => [c.id, i]));
  filas.sort(
    (a, b) =>
      (a.item ?? Number.MAX_SAFE_INTEGER) - (b.item ?? Number.MAX_SAFE_INTEGER) ||
      (ordenCuadernillo.get(a.cuadernilloId) ?? 0) - (ordenCuadernillo.get(b.cuadernilloId) ?? 0),
  );

  return {
    prueba: {
      id: input.prueba.id,
      name: input.prueba.name,
      year: input.prueba.year,
    },
    grupo: {
      id: input.grupo.id,
      name: input.grupo.name,
      courseName: input.grupo.courseName,
    },
    resumen,
    filas,
  };
}
