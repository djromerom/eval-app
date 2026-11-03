/**
 * DTO de una **asignación pendiente** de una prueba: la tupla
 * (Prueba × Grado × Asignatura × Tipo de cuadernillo) que la prueba todavía no
 * tiene formulada.
 *
 * Son las asignaciones "que aún no han empezado": el listado de formulaciones
 * las trae para que el admin vea qué falta, no solo lo que ya está escrito.
 *
 * La tupla puede venir de dos fuentes:
 *   - la **regla de conteo** (trae cuadernillo e ítems esperados);
 *   - la **asignación docente** sin regla de conteo (sin cuadernillo cuando
 *     el docente está asignado a "cualquier tipo", y sin ítems esperados).
 *
 * No es una `FormulacionRow` (no hay `Evaluation` detrás): por eso tiene su
 * propio tipo y las celdas que no aplican quedan en `null`/vacío.
 */
export interface AsignacionPendiente {
  /** Identifica la fila: prueba + tupla (grado, asignatura, cuadernillo). */
  id: string;
  /** Nombre de la asignatura (Subject.name). */
  subjectName: string;
  /** Nombre del grado (Course.name). */
  courseName: string;
  /** Año académico de la prueba (AcademicYear.year). */
  academicYearYear: number;
  /** Prueba (Period.id). */
  periodId: string;
  /** Prueba (Period.name). */
  periodName: string;
  /** Tipo de cuadernillo (BookletType.id). `null` = "cualquier tipo". */
  bookletTypeId: string | null;
  /** Tipo de cuadernillo (BookletType.name). `null` = "cualquier tipo". */
  bookletTypeName: string | null;
  /** Ítems que exige la regla de conteo de la tupla. `null` = sin regla. */
  itemsExpected: number | null;
  /** Docentes asignados a esa asignatura-grado con ese tipo de cuadernillo
   *  (o con "cualquier tipo"). */
  assignedTeachers: string[];
}
