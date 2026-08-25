/**
 * Defaults textuales para la portada del cuadernillo.
 *
 * Son los textos institucionales que NO cambian por bundle: el aviso de
 * "Instrucciones", los bullets de cómo marcar, el "Prohibido", etc.
 *
 * Mantenerlos en código (no en BD) tiene dos motivos:
 *   1. No son configurables hoy — vienen del formato ICFES que la institución
 *      está replicando. Cambiarlos requiere tocar el formato entero.
 *   2. Asegura consistencia entre bundles: si dos cursos imprimen la misma
 *      portada, los bullets son idénticos.
 *
 * Si en el futuro la institución quiere editar el wording de "Prohibido", el
 * upgrade path es mover los textos a `Institution.coverCopy` (o tabla
 * aparte) y fusionarlos aquí. Hoy viven en código por simplicidad.
 *
 * Los textos coinciden con el formato ICFES real (ver `Prueba__11º_I_periodo_C3__1_.pdf`).
 * Si los modificas, regenera el mock de secundaria-v1 y verifica que aún
 * cabe en 11in × 17in con la tipografía de la plantilla.
 */

export const DEFAULT_INSTRUCTIONS_TITLE = "Instrucciones";

export const DEFAULT_INSTRUCTIONS_ITEMS_BEFORE: readonly string[] = [
  "El Cuadernillo contiene la prueba de preguntas cerradas, la Hoja de respuestas y una Hoja para operaciones.",
  "Desprenda la Hoja de respuestas, teniendo cuidado de no rasgarla o dañarla.",
  "Las preguntas de este examen constan de un enunciado y múltiples opciones de respuesta, entre las cuales usted debe escoger la que considere correcta.",
  "Lea cuidadosamente cada pregunta antes de responder y verifique que está marcando correctamente en su Hoja de respuestas.",
];

export const DEFAULT_CALLOUT_TEXT =
  "Conteste únicamente en su Hoja de respuestas, rellenando los círculos con lápiz negro número 2.";

export const DEFAULT_HOW_TO_MARK_QUESTION = "¿CÓMO MARCAR EN SU HOJA DE RESPUESTAS?";
export const DEFAULT_HOW_TO_MARK_EXAMPLE = "Por ejemplo, si la opción correcta es B";
export const DEFAULT_HOW_TO_MARK_LABEL = "MARQUE ASÍ";

/** Cuatro círculos A B C D con B marcado. Es el ejemplo por defecto del formato
 *  ICFES. La letra "B" es la marcada (filled=true); las demás vacías. */
export const DEFAULT_HOW_TO_MARK_CIRCLES: ReadonlyArray<{
  letter: string;
  filled: boolean;
}> = [
  { letter: "A", filled: false },
  { letter: "B", filled: true },
  { letter: "C", filled: false },
  { letter: "D", filled: false },
];

export const DEFAULT_INSTRUCTIONS_ITEMS_AFTER: readonly string[] = [
  "No haga señales ni marcas adicionales; no maltrate ni doble esta Hoja.",
  "No marque más de una respuesta por pregunta porque le será anulada.",
  "Verifique que el número de la respuesta coincida con el número de la pregunta.",
  "Borre totalmente la respuesta que desee cambiar, teniendo cuidado de no dañar la Hoja de respuestas.",
  "Firme al respaldo de su Hoja de respuestas con esfero, cuando el jefe de salón se lo indique.",
  "Al finalizar la sesión, entréguele TODO el material al jefe de salón.",
];

export const DEFAULT_PROHIBITED_TITLE = "Prohibido";

export const DEFAULT_PROHIBITED_BODY =
  "Está prohibido manipular teléfonos, equipos celulares, relojes, gafas inteligentes o cualquier dispositivo de comunicación, entre otros, dentro de cualquier lugar del sitio de aplicación.";

/** Pie legal al pie de la portada. Si la institución tiene legalFooter en BD
 *  (hoy: ninguno en el modelo), gana sobre este default. */
export const DEFAULT_LEGAL_FOOTER =
  "Material de uso exclusivo del establecimiento educativo. Prohibida su reproducción parcial o total.";

/** Color de acento por defecto cuando la institución no tiene
 *  Institution.theme.primaryColor seteado. Usado por variantes que sí
 *  pintan bordes con un color institucional (p.ej. primaria-v1). La
 *  variante secundaria-v1 no usa este color — su paleta es solo tinta+grises. */
export const DEFAULT_PRIMARY_COLOR = "#2563eb";

/** Etiqueta de la sesión cuando el bundle no la provee. Por ahora todos
 *  los bundles son "Primera sesión" — multi-sesión es un upgrade futuro. */
export const DEFAULT_SESSION_NAME = "Primera sesión";
export const DEFAULT_SESSION_LABEL_SHORT = "Primera sesión";
