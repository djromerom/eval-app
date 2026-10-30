/**
 * DTO de una fila de la consulta "Reglas de conteo por prueba".
 *
 * Una fila = UNA regla de conteo (`EvaluationRule`), es decir la tupla
 * (Prueba × Grado × Asignatura × Tipo de cuadernillo) con el número exacto
 * de ítems que exige.
 *
 * A diferencia de `FormulacionRow` (que es una fila por evaluación), aquí
 * la fila es la REGLA: sirve para ver, de un vistazo, qué reglas hay
 * configuradas en una prueba y cuántas formulaciones llevan cada una.
 */
export interface ReglaConteoRow {
  /** Id de la regla (`EvaluationRule.id`). */
  id: string;
  /** Id de la Prueba (periodo). */
  periodId: string;
  /** Nombre de la Prueba (Period.name). */
  periodName: string;
  /** Año académico de la Prueba (AcademicYear.year). */
  academicYearYear: number;
  /** Grado (Course.name). */
  courseName: string;
  /** Asignatura (Subject.name). */
  subjectName: string;
  /** Tipo de cuadernillo (BookletType.name). */
  bookletTypeName: string;
  /** Ítems exactos que exige la regla. */
  exactQuestions: number;
  /** Cuántas formulaciones (evaluaciones) llevan esta regla. */
  formuladas: number;
}
