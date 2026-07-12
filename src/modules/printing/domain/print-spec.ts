/**
 * Especificación física de la plantilla de impresión ICFES institucional
 * (REQUERIMIENTOS_v2.md §3.4 y §8). Validar todo cambio contra el PDF
 * de referencia: Prueba__11º_I_periodo_C3__1_.pdf
 */
export const PRINT_SPEC = {
  /** Doble carta (Tabloid): 11 × 17 in, horizontal, doblez al centro */
  pageSize: { widthMm: 431.8, heightMm: 279.4 },
  marginMm: 20,
  spineMarginMm: 25,
  bodyFontPt: 10,
  headingFontPt: 12,
  lineHeight: 1.15,
} as const;

/** Burbujas OMR de la hoja de respuestas (§11). */
export const ANSWER_SHEET_SPEC = {
  bubbleDiameterMm: 6,
  bubbleSpacingMm: 10, // centro a centro
  /** 4 círculos en esquinas + 2 rectángulos laterales, negro 100% */
  fiducials: { corners: 4, lateral: 2 },
} as const;

/** Orden obligatorio de las secciones de la portada (página 1). */
export const COVER_SECTIONS = [
  "institutionName",
  "testTitle",
  "grade",
  "areasTable", // solo cuadernillos multi-área
  "bookletNumber", // "CUADERNILLO N"
  "greeting", // "¡Hola!"
  "instructions",
  "markExample", // "Marca así:" con burbuja A rellena
  "studentFields", // Nombre / Grado / Fecha
] as const;
