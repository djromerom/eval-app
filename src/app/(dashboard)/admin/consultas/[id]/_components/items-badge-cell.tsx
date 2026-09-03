/**
 * Celda del badge "X / Y" — server-renderable. Sin `"use client"`: lo usa el
 * `FormulacionesTable` (que sí es client) y se rendereá server-side.
 *
 * Tokens de color (verde/ámbar/rojo/gris) basados en los CSS vars del theme
 * ecognIA (`src/app/globals.css`). Si el repo añade `bg-success-foreground`,
 * `bg-warning-foreground` etc, este mapping se queda como está.
 */
import type { ItemsBadge } from "@/modules/consultas/domain/shared/items-badge";

const STYLE: Record<ItemsBadge, { className: string; ariaLabel: string }> = {
  ok: {
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    ariaLabel: "Cantidad exacta",
  },
  low: {
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    ariaLabel: "Faltan preguntas",
  },
  high: {
    className: "bg-red-500/15 text-red-700 dark:text-red-400",
    ariaLabel: "Sobran preguntas",
  },
  none: {
    className: "bg-muted text-muted-foreground",
    ariaLabel: "Sin regla configurada",
  },
};

export function ItemsBadgeCell({
  total,
  expected,
  badge,
}: {
  total: number;
  expected: number | null;
  badge: ItemsBadge;
}) {
  const style = STYLE[badge];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${style.className}`}
      aria-label={style.ariaLabel}
      title={
        expected == null
          ? "Sin regla configurada para esta tupla"
          : `${total} de ${expected} preguntas`
      }
    >
      {total}
      {expected != null ? ` / ${expected}` : " · sin regla"}
    </span>
  );
}
