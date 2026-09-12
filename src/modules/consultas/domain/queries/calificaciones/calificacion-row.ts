/**
 * DTO de una fila de la consulta "Calificaciones": **una hoja calificada**
 * (o pendiente) de un estudiante en una prueba.
 *
 * La granularidad es la hoja física, no el estudiante: un estudiante que
 * presentó dos cuadernillos aparece dos veces, y una hoja re-escaneada
 * aparece por cada escaneo. Es lo que permite auditar el lote contra el papel.
 *
 * Solo hojas **identificadas**: si el QR no se pudo resolver, la hoja no es
 * una calificación de nadie y se atiende en la revisión del lote, no acá. Por
 * eso estudiante, grado y grupo nunca son null — el camino
 * `Student -> Group -> Course` es obligatorio en el esquema.
 *
 * Sí siguen siendo nullables `totalCorrect`/`puntaje`: una hoja identificada
 * puede estar todavía sin calificar (`graded === false`).
 */
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
  /** Estado crudo del escaneo (`GRADED`, `REVIEW`, `PENDING`, ...). */
  status: string;
  /** `true` solo si la hoja ya fue calificada. Precomputado para que la UI no
   *  repita la regla. */
  graded: boolean;
  totalCorrect: number | null;
  totalQuestions: number | null;
  /** Escala 0-10 con piso de 3 — ver `calcularPuntaje`. No es
   *  `AnswerSheet.score`, que guarda el conteo crudo de aciertos. */
  puntaje: number | null;
  /** Cuándo se creó la hoja en el lote (sirve de orden cronológico). */
  scannedAt: Date;
}
