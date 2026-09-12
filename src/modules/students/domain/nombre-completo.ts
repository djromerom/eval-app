/**
 * Nombre visible de un estudiante a partir de los cuatro campos del esquema.
 *
 * La convención colombiana parte el nombre en APELLIDO1 + APELLIDO2 +
 * NOMBRE1 + NOMBRE2, con los segundos opcionales. Se muestra "APELLIDOS,
 * NOMBRES" porque es el orden con el que se buscan listados de curso.
 *
 * Vive acá y no en cada pantalla porque se arma en cuatro lugares distintos
 * (consulta de calificaciones, resumen por asignatura, revisión del lote y
 * detalle de hoja) y tres de ellos lo tenían copiado con matices propios.
 */
export interface NombrePartido {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
}

export function nombreCompleto(s: NombrePartido): string {
  const apellidos = [s.lastName1, s.lastName2].filter(Boolean).join(" ").trim();
  const nombres = [s.firstName1, s.firstName2].filter(Boolean).join(" ").trim();
  return [apellidos, nombres].filter(Boolean).join(", ");
}
