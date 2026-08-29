import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";

/** Estados filtrables en el módulo de revisión del coordinador.
 *  Sprint ago 2026: nuevo filtro dropdown que reemplaza las dos secciones
 *  estáticas (IN_REVIEW + APPROVED) por un selector único con los tres
 *  estados visibles para el líder (IN_REVIEW / APPROVED / PUBLISHED).
 *
 *  NO vive en `status-filter.tsx` (es `"use client"`) porque importarlo
 *  desde un server component lo convierte en una client reference y
 *  `Array.prototype.find` deja de estar disponible en el server (ver el
 *  error "_status_filter_.REVIEW_FILTER_OPTIONS.find is not a function" que
 *  tira el runtime de Next al cargar /coordinator/review). */
export const REVIEW_FILTER_OPTIONS: Array<{ value: EvaluationStatus; label: string }> = [
  { value: "IN_REVIEW", label: "En revisión" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "PUBLISHED", label: "Publicadas" },
];
