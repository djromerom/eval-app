/**
 * Estado de la calificación de una hoja, desde el punto de vista de quien
 * revisa un lote.
 *
 * No es el `ScanStatus` crudo: ese solo distingue `GRADED` de `REVIEW` y se
 * queda corto, porque una hoja puede estar en `REVIEW` **y tener puntaje** —
 * el motor marca así las que traen alguna respuesta ambigua. Cruzando estado y
 * puntaje salen las tres situaciones que importan de verdad:
 *
 *   - `calificada`   — tiene puntaje y nada que revisar.
 *   - `observaciones`— tiene puntaje, pero el motor marcó algo (marcas
 *                      múltiples o ambiguas). La nota existe y es usable, pero
 *                      conviene mirar el papel antes de darla por buena.
 *   - `pendiente`    — todavía sin puntaje.
 */
export type EstadoCalificacion = "calificada" | "observaciones" | "pendiente";

export const ESTADOS: readonly { valor: EstadoCalificacion; etiqueta: string }[] = [
  { valor: "calificada", etiqueta: "Calificadas" },
  { valor: "observaciones", etiqueta: "Con observaciones" },
  { valor: "pendiente", etiqueta: "Pendientes" },
] as const;

export function estadoDeHoja(score: number | null, scanStatus: string): EstadoCalificacion {
  if (score === null) return "pendiente";
  // El motor deja en REVIEW lo que necesita ojo humano aunque ya tenga nota.
  return scanStatus === "REVIEW" ? "observaciones" : "calificada";
}

export function etiquetaEstado(e: EstadoCalificacion): string {
  return ESTADOS.find((x) => x.valor === e)?.etiqueta ?? e;
}
