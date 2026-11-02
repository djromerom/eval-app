/**
 * DTO de una Prueba (Periodo) como opción de filtro, compartido por las
 * consultas que filtran por prueba.
 *
 * El módulo `academic` ya tiene el concepto de "prueba actual"
 * (`Period.isCurrent`, una por año académico) y de "año académico actual"
 * (`AcademicYear.isCurrent`, uno por institución). Esta forma proyecta los dos
 * flags juntos para que la UI pueda resolver "cuál es la prueba que está en
 * curso" sin saber del módulo academic.
 */
export interface PruebaOpcion {
  id: string;
  name: string;
  academicYearId: string;
  year: number;
  /** Prueba actual dentro de su año. */
  isCurrent: boolean;
  /** El año de la prueba es el año académico actual. */
  yearIsCurrent: boolean;
}

/**
 * La prueba que está en curso: la actual del año académico actual; si no hay
 * ninguna, la actual de cualquier año; si no hay ninguna marcada, `null`.
 *
 * `null` significa "el filtro queda en todas las pruebas": un filtro que se
 * cerrara sobre la primera prueba de la lista dejaría fuera todo lo demás
 * sin que nadie lo pidiera.
 */
export function pruebaActual(pruebas: readonly PruebaOpcion[]): PruebaOpcion | null {
  return (
    pruebas.find((p) => p.isCurrent && p.yearIsCurrent) ?? pruebas.find((p) => p.isCurrent) ?? null
  );
}
