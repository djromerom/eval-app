import type { EstadoCalificacion } from "./estado";

/**
 * DTO de una fila de la consulta "Calificaciones": **una hoja calificada**
 * (o pendiente) de un estudiante en una prueba.
 *
 * La granularidad es la hoja física, no el estudiante: un estudiante que
 * presentó dos cuadernillos aparece dos veces, y una hoja re-escaneada
 * aparece por cada escaneo. Es lo que permite auditar el lote contra el papel.
 *
 * Solo hojas **identificadas**, y **una por estudiante y prueba**: la última
 * modificada, cualquiera sea su estado. Una hoja sin QR resuelto no es la
 * calificación de nadie y se atiende en la revisión del lote.
 *
 * Que la fila sea siempre la última importa: si un estudiante tiene una
 * calificación vieja y un reescaneo reciente sin procesar, lo que se reporta
 * es el reescaneo pendiente. Es la única forma de que el filtro de estado
 * sirva para lo que se pidió — encontrar a quién le falta algo — en vez de
 * esconder el problema detrás de una nota anterior.
 *
 * Estudiante, grado y grupo nunca son null porque `Student -> Group -> Course`
 * es obligatorio en el esquema. El puntaje y los conteos sí lo son: una hoja
 * pendiente todavía no los tiene.
 */
/** Una hoja del historial de ese estudiante en esa prueba. La fila de la
 *  consulta muestra la vigente; el resto queda acá para poder responder "¿por
 *  qué esta nota y no la otra?" sin salir de la consulta. */
export interface EntradaHistorial {
  sheetId: string;
  batchId: string | null;
  /** `updatedAt`: el mismo reloj con el que se eligió la vigente. */
  fecha: Date;
  estado: EstadoCalificacion;
  puntaje: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  /** `true` en la que la consulta está reportando. */
  vigente: boolean;
}

export interface CalificacionRow {
  /** Id de la `AnswerSheet`. Estable, sirve de key en la UI. */
  sheetId: string;
  /** Lote al que pertenece la hoja. Con él se arma el enlace al detalle
   *  (`/teacher/scan/<batchId>/<sheetId>`). Null en hojas antiguas cargadas
   *  fuera de un lote: esas no tienen pantalla de detalle a la que ir. */
  batchId: string | null;

  // --- estudiante ---
  studentName: string;
  studentCode: string;

  // --- ubicación académica (lo que se filtra) ---
  courseId: string;
  courseName: string;
  groupId: string;
  groupName: string;

  /** Nombre del cuadernillo o título de la formulación, según de cuál cuelgue. */
  assessmentName: string;
  /** Prueba / periodo académico (`Period`). Mismo vocabulario que la consulta
   *  de formulaciones. Null: hay cuadernillos y evaluaciones sin periodo
   *  (diagnósticas, finales). */
  periodId: string | null;
  periodName: string | null;
  /** Tipo de cuadernillo (`BookletType`: Estándar / Especial / Recuperación).
   *  Null por la misma razón. */
  bookletTypeId: string | null;
  bookletTypeName: string | null;

  // --- resultado ---
  /** Estado crudo del escaneo, por trazabilidad. Para mostrar y filtrar se usa
   *  `estado`, que lo cruza con el puntaje (ver `estadoDeHoja`). */
  status: string;
  estado: EstadoCalificacion;
  totalCorrect: number | null;
  totalQuestions: number | null;
  /** Escala 0-10 con piso de 3 — ver `calcularPuntaje`. No es
   *  `AnswerSheet.score`, que guarda el conteo crudo de aciertos.
   *  `null` mientras la hoja esté pendiente. */
  puntaje: number | null;
  /** Cuándo se creó la hoja en el lote (sirve de orden cronológico). */
  scannedAt: Date;
  /** Todas las hojas de este estudiante en esta prueba, de la más reciente a
   *  la más vieja. Incluye la vigente. Siempre tiene al menos un elemento. */
  historial: EntradaHistorial[];
}
