/**
 * DTO de una fila de la consulta "Regla de conteo".
 *
 * Una fila = UNA regla de conteo (`EvaluationRule`), es decir la tupla
 * (Prueba × Grado × Asignatura × Tipo de cuadernillo) con el número exacto
 * de ítems que exige.
 *
 * A diferencia de `FormulacionRow` (que es una fila por evaluación), aquí
 * la fila es la REGLA: sirve para ver, de un vistazo, qué reglas hay
 * configuradas en una prueba y cuántos ítems se han formulado ya para cada
 * una.
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
  /**
   * Ítems (preguntas) YA FORMULADOS para esta regla: la suma de los ítems
   * de las formulaciones que caen en su misma tupla (Prueba × Grado ×
   * Asignatura × Tipo de cuadernillo).
   *
   * No es el número de formulaciones: la regla exige un conteo exacto de
   * ítems por formulario, así que lo útil es saber cuántos ítems hay ya
   * redactados frente a los que exige la regla.
   */
  itemsFormulados: number;
}
