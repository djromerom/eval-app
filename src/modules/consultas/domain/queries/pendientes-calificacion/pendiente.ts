/**
 * DTO de la consulta "Pendientes de calificación".
 *
 * Una fila = un estudiante frente a un cuadernillo de la prueba, cuando algo
 * falta: no entregó la hoja, la hoja está sin calificar, o la hoja llegó sin
 * una sola opción marcada.
 *
 * **Por qué la granularidad es (estudiante × cuadernillo) y no estudiante.**
 * La prueba se aplica por cuadernillo: un estudiante de 11° puede tener dos
 * cuadernillos (cuadernillo 1 y 2) y cada uno se entrega por separado. Si la
 * fila fuera por estudiante, un chico que marcó el cuadernillo 1 y entregó en
 * blanco el 2 no aparecería — y ese es justo el caso que hay que perseguir.
 * Con la granularidad por cuadernillo, cada faltante sale con su motivo.
 */

/** Por qué el estudiante está pendiente. */
export type MotivoPendiente =
  /** No hay ninguna hoja escaneada de ese cuadernillo: no presentó o nadie
   *  escaneó el papel. */
  | "sin-hoja"
  /** Hay hoja, pero sin puntaje: pendiente de procesar o en revisión. */
  | "sin-calificar"
  /** Hay hoja con puntaje, pero no marcó ni una opción: entregó el papel en
   *  blanco (o con marcas que el motor no pudo leer). */
  | "sin-marcar";

export const MOTIVOS: readonly { valor: MotivoPendiente; etiqueta: string }[] = [
  { valor: "sin-hoja", etiqueta: "Sin hoja" },
  { valor: "sin-calificar", etiqueta: "Sin calificar" },
  { valor: "sin-marcar", etiqueta: "Sin marcar" },
] as const;

export function etiquetaMotivo(motivo: MotivoPendiente): string {
  return MOTIVOS.find((m) => m.valor === motivo)?.etiqueta ?? motivo;
}

/** Etiqueta del estado de escaneo de la hoja, para que el docente sepa si lo
 *  que falta es un papel que nunca llegó o uno que está en la cola del
 *  worker. */
export const ESTADOS_HOJA: Record<string, string> = {
  PENDING: "Sin procesar",
  SCANNED: "Escaneada",
  PROCESSING: "Procesando",
  GRADED: "Calificada",
  REVIEW: "En revisión",
  COMPLETED: "Revisada",
};

export function etiquetaEstadoHoja(status: string | null): string | null {
  if (status === null) return null;
  return ESTADOS_HOJA[status] ?? status;
}

export interface FilaPendiente {
  /** Número de lista impreso en la hoja de respuestas. `null` si el estudiante
   *  ya no está en el grupo. */
  item: number | null;
  studentId: string;
  studentName: string;
  studentCode: string;
  courseName: string;
  groupName: string;
  /** Cuadernillo de la prueba (`EvaluationBundle.id`). */
  cuadernilloId: string;
  cuadernilloName: string;
  /** Siglas de las asignaturas que cubre el cuadernillo. */
  asignaturas: string;
  motivo: MotivoPendiente;
  /** Estado de escaneo de la hoja. `null` = no hay hoja. */
  estadoHoja: string | null;
  /** Respuestas con una opción marcada. `null` = no hay hoja. */
  marcadas: number | null;
  /** Respuestas registradas en la hoja. `null` = no hay hoja. */
  totalRespuestas: number | null;
  /** Puntaje 0-10 con piso de 3. `null` = la hoja no tiene nota. */
  puntaje: number | null;
  /** Cuándo se escaneó la hoja. `null` = no hay hoja. */
  escaneadaAt: Date | null;
}

export interface PendientesInforme {
  prueba: { id: string; name: string; year: number };
  grupo: { id: string; name: string; courseName: string };
  /** Conteo por motivo, para el resumen de arriba de la tabla. */
  resumen: { sinHoja: number; sinCalificar: number; sinMarcar: number; total: number };
  filas: FilaPendiente[];
}
