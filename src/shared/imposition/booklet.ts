/**
 * Imposición saddle-stitch para cuadernillo (libreta) doble carta.
 *
 * Contexto: el worker PDF genera primero un PDF "lineal" donde cada página
 * lógica del examen (portada, p1, p2, …) es una página carta. Para entregar
 * un cuadernillo doble carta listo para impresión, hay que REORDENAR esas
 * páginas en cada cara del pliego 17×11 horizontal de modo que, al doblar
 * el pliego al centro y apilar los pliegos en orden, las páginas queden en
 * secuencia al hojear.
 *
 * Esta función es PURA: recibe el número de páginas lógicas y devuelve las
 * coordenadas y el orden en que deben disponerse. No toca PDFs; quien la usa
 * (worker PDF) la aplica con pdf-lib.
 *
 * Convención (Adobe / pdfbook):
 *
 *   Sheet s (1 = el más EXTERIOR, contiene la cubierta):
 *
 *     FRONT (cuando el pliego está plano, mirando el anverso):
 *       Mitad izquierda  = N - 2s + 2
 *       Mitad derecha    = 2s - 1
 *
 *     BACK (reverso del pliego; el orden izq/der queda espejado si la
 *     impresora voltea por el borde largo):
 *       Mitad izquierda  = 2s
 *       Mitad derecha    = N - 2s + 1
 *
 *   Si N no es múltiplo de 4, se hace padding con páginas blancas al final
 *   (sustituyendo por `null` los slots que excedan el rango 1..N).
 *
 *   El worker itera los slots en orden [FL, FR, BL, BR] por pliego, y los
 *   pliegos en orden [1..sheets], y los dibuja sobre el pliego destino en
 *   la misma posición física. Al imprimir a doble cara y doblar, el lector
 *   ve las páginas en orden 1..N.
 */

/** Cara del pliego en la que va una página. */
export type SheetFace = "FRONT_LEFT" | "FRONT_RIGHT" | "BACK_LEFT" | "BACK_RIGHT";

/** Slot en el que cae una página lógica al imponer el cuadernillo. */
export interface ImpositionSlot {
  /** Índice del pliego (0-based; 0 = el más exterior, contiene la cubierta). */
  sheetIndex: number;
  /** Cara del pliego. */
  face: SheetFace;
  /** Página lógica del examen que va aquí (1-based). `null` = blanco. */
  logicalPage: number | null;
}

/**
 * Calcula la imposition para un examen de `logicalPages` páginas.
 *
 * @param logicalPages  número de páginas lógicas (portada, preguntas, …).
 * @returns             slots en orden de pliego y cara. Cada pliego produce
 *                      4 entradas: front-left, front-right, back-left, back-right.
 */
export function computeBookletImposition(logicalPages: number): ImpositionSlot[] {
  if (!Number.isInteger(logicalPages) || logicalPages < 1) {
    throw new Error(`logicalPages debe ser entero ≥ 1 (recibido: ${logicalPages})`);
  }

  // Redondeo hacia arriba al múltiplo de 4 con páginas blancas al final.
  const padded = Math.ceil(logicalPages / 4) * 4;
  const sheets = padded / 4;
  const slots: ImpositionSlot[] = [];

  for (let s = 1; s <= sheets; s++) {
    // Convención Adobe/pdfbook: sheet 1 = exterior (contiene cubierta).
    const fl = padded - 2 * s + 2; // front-left  = N - 2s + 2
    const fr = 2 * s - 1; //           front-right = 2s - 1
    const bl = 2 * s; //               back-left   = 2s
    const br = padded - 2 * s + 1; //  back-right  = N - 2s + 1

    slots.push({
      sheetIndex: s - 1,
      face: "FRONT_LEFT",
      logicalPage: fl > 0 && fl <= logicalPages ? fl : null,
    });
    slots.push({
      sheetIndex: s - 1,
      face: "FRONT_RIGHT",
      logicalPage: fr > 0 && fr <= logicalPages ? fr : null,
    });
    slots.push({
      sheetIndex: s - 1,
      face: "BACK_LEFT",
      logicalPage: bl > 0 && bl <= logicalPages ? bl : null,
    });
    slots.push({
      sheetIndex: s - 1,
      face: "BACK_RIGHT",
      logicalPage: br > 0 && br <= logicalPages ? br : null,
    });
  }

  return slots;
}

/**
 * Reordena una lista de páginas lógicas (1-based) según la imposition.
 * Devuelve un array en el orden en que deben imprimirse las caras de pliego.
 *
 * Orden de salida: pliego 0 [FL, FR, BL, BR], pliego 1 [FL, FR, BL, BR], …
 */
export function buildImposedPageOrder(logicalPages: number): (number | null)[] {
  return computeBookletImposition(logicalPages).map((s) => s.logicalPage);
}

/**
 * Helper: agrega páginas blancas al final para llegar a múltiplo de 4.
 * El worker PDF lo usa para garantizar que la imposition es limpia.
 */
export function padToMultipleOf4(pageCount: number): number {
  return Math.ceil(pageCount / 4) * 4;
}

/** Dimensiones del pliego doble carta en puntos PDF (1pt = 1/72 in). */
export const TABLOID_PT = {
  width: 17 * 72, // 1224 pt
  height: 11 * 72, // 792 pt
} as const;

/** Dimensiones de la mitad lógica del pliego (= carta apaisada). */
export const HALF_TABLOID_PT = {
  width: TABLOID_PT.width / 2, // 612 pt = 8.5 in
  height: TABLOID_PT.height, // 792 pt = 11 in
} as const;
