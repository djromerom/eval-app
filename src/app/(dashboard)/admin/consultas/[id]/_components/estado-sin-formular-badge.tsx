/**
 * Estado de las **asignaciones pendientes**: la tupla de la prueba que todavía
 * no tiene formulación detrás. Sin `"use client"` — lo usa el
 * `FormulacionesTable` (que sí es client) y se rendereá server-side.
 *
 * Mismo lenguaje visual que `StatusBadge` (chip redondeado, texto-xs): gris
 * (`bg-muted text-muted-foreground`) porque no es un estado de workflow, sino
 * la ausencia de formulación.
 */
export function EstadoSinFormularBadge() {
  return (
    <span className="bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium">
      Sin formular
    </span>
  );
}
