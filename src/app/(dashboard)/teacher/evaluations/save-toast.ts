"use client";

import { toast } from "sonner";

/**
 * Toast de éxito al guardar un ítem.
 *
 * Centraliza el copy en un único punto (antes vivía dentro del editor
 * unificado) para que el QuestionForm — que es quien sabe si el guardado
 * pasó por la revisión con IA o no — pueda avisarle al docente qué pasó
 * con la IA en cada caso.
 *
 * (oct 2026, pedido del docente: "mostrar un mensaje toast despues de
 * guardar y si lo guarda con IA y no tiene sugerencias que el mensaje
 * muestre que no hubo sugerencias por la IA").
 */

/** Cómo se llegó al guardado: define el texto secundario del toast. */
export type SaveToastMode =
  /** Guardado normal (sin IA). */
  | "normal"
  /** Guardado con IA y la IA no encontró nada que sugerir. */
  | "ia-sin-sugerencias"
  /** Guardado con IA, pero el docente eligió ignorar las sugerencias. */
  | "ia-ignorado"
  /** Guardado con la corrección propuesta por la IA. */
  | "ia-corregido"
  /** Se intentó revisar con IA pero la revisión no pudo completarse. */
  | "ia-no-reviso";

/** Texto principal del toast (sin cambios: ya se usaba en el editor unificado). */
export const TOAST_SAVED = "El ítem fue guardado de manera correcta";

/** Texto secundario según cómo se guardó. `undefined` = sin segunda línea. */
const DESCRIPCION: Record<SaveToastMode, string | undefined> = {
  normal: undefined,
  "ia-sin-sugerencias": "La IA no hizo ninguna sugerencia.",
  "ia-ignorado": "Se guardó sin aplicar las sugerencias de la IA.",
  "ia-corregido": "Se guardó con las correcciones sugeridas por la IA.",
  "ia-no-reviso": "No se pudo completar la revisión con IA.",
};

/** Muestra el toast de guardado con el detalle que corresponda al modo. */
export function notifyItemSaved(mode: SaveToastMode = "normal") {
  const description = DESCRIPCION[mode];
  if (description) {
    toast.success(TOAST_SAVED, { description });
    return;
  }
  toast.success(TOAST_SAVED);
}
