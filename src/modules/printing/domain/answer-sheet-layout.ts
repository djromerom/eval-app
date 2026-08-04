/**
 * Helper puro para el layout de la hoja de respuestas (OMR) con preguntas
 * de número de opciones variable (2..8). Sprint 1 del módulo cuadernillos.
 *
 * Ver docs/cuadernillos.md §"Soporte de opciones variables". El booklet PDF
 * (single-evaluation, ya existente) y la hoja unificada (bundle, Sprint 2)
 * reusan este helper. Las burbujas tienen tamaño físico constante en mm;
 * solo cambia el espaciado entre ellas y el ancho total de la fila según
 * `options.length` de cada pregunta.
 *
 * **Por qué no es parte del sheet PDF generator:** ese generador renderiza
 * filas con columnas uniformes. Al introducir preguntas con 8 opciones (caso
 * del ejemplo real del colegio, preguntas 60-65), las filas se desbalancean
 * si no se computa el ancho por pregunta. Este helper es la fuente única
 * de verdad del layout.
 */
import { ANSWER_SHEET_SPEC } from "./print-spec";

/** Pregunta que el helper recibe. Independiente del modelo Prisma. */
export interface LayoutQuestion {
  /** Número de la pregunta (1-based, continuo a través del bundle). */
  number: number;
  /** Cantidad de opciones: 2..8 (restringido por EVAL_MAX_OPTIONS). */
  optionsLength: number;
}

/** Posición física de una burbuja en mm, relativo al origen del bloque. */
export interface BubblePosition {
  /** Centro X de la burbuja en mm, medido desde el margen izquierdo del bloque. */
  centerXmm: number;
  /** Centro Y en mm, medido desde el margen superior del bloque. */
  centerYmm: number;
  /** Letra ("A", "B", ..., "H") que se imprime sobre la burbuja. */
  letter: string;
}

/** Una fila = una pregunta, con sus N burbujas posicionadas. */
export interface LayoutRow {
  questionNumber: number;
  columns: number;
  bubbles: BubblePosition[];
  /** Ancho total de la fila en mm (útil para page-break si excede). */
  widthMm: number;
}

/** Una página de la hoja. */
export interface LayoutPage {
  pageIndex: number;
  rows: LayoutRow[];
}

/** Resultado completo del layout. */
export interface AnswerSheetLayout {
  pages: LayoutPage[];
  totalPages: number;
  totalQuestions: number;
}

export interface AnswerSheetLayoutInput {
  questions: LayoutQuestion[];
  /** Ancho útil del bloque (área imprimible entre márgenes) en mm. */
  blockWidthMm: number;
  /** Alto útil del bloque en mm. */
  blockHeightMm: number;
  /** Espacio vertical entre filas en mm (default: 2 * bubbleSpacingMm). */
  rowGapMm?: number;
  /** Margen interno al bloque antes de la primera burbuja en mm. */
  innerPaddingMm?: number;
}

/** Letras A-H usadas como keys de las opciones OMR. */
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/**
 * Calcula el layout completo: divide las preguntas en páginas según el alto
 * disponible, posiciona las burbujas de cada fila según el número de
 * columnas de esa pregunta, y devuelve las coordenadas en mm listas para
 * que el render (Puppeteer/HTML+CSS o pdf-lib) las coloque.
 *
 * Estrategia:
 *   1. Por cada pregunta se calcula el ancho de fila según `optionsLength`
 *      (cada burbuja + gap entre ellas + letter text).
 *   2. Si la pregunta no cabe en `blockWidthMm`, se mueve a la siguiente
 *      página (page break horizontal, evita overflow).
 *   3. Las filas se apilan verticalmente; si se excede `blockHeightMm`,
 *      salta a la siguiente página (page break vertical, normal).
 *
 * El render (Puppeteer) usa estos mm traducidos a px (1mm ≈ 3.7795 px
 * a 96 DPI); los helpers existentes en `print/answer-sheet/...` ya hacen
 * la conversión.
 */
export function computeAnswerSheetLayout(input: AnswerSheetLayoutInput): AnswerSheetLayout {
  const {
    questions,
    blockWidthMm,
    blockHeightMm,
    rowGapMm = ANSWER_SHEET_SPEC.bubbleSpacingMm * 2,
    innerPaddingMm = 4,
  } = input;

  if (blockWidthMm <= 0 || blockHeightMm <= 0) {
    throw new Error(
      `blockWidthMm y blockHeightMm deben ser > 0 (recibido ${blockWidthMm}, ${blockHeightMm})`,
    );
  }

  const usableWidth = blockWidthMm - innerPaddingMm * 2;
  if (usableWidth <= 0) {
    throw new Error(
      `innerPaddingMm demasiado grande: ${innerPaddingMm} para bloque de ${blockWidthMm}mm`,
    );
  }

  const pages: LayoutPage[] = [];
  let currentPage: LayoutPage = { pageIndex: 0, rows: [] };
  let currentY = innerPaddingMm;
  let cursorX = innerPaddingMm;

  const flushPage = () => {
    if (currentPage.rows.length > 0) {
      pages.push(currentPage);
    }
    currentPage = { pageIndex: pages.length, rows: [] };
    currentY = innerPaddingMm;
    cursorX = innerPaddingMm;
  };

  for (const q of questions) {
    validateQuestion(q);
    const rowWidth = computeRowWidthMm(q.optionsLength, innerPaddingMm);
    const rowHeight = ANSWER_SHEET_SPEC.bubbleSpacingMm;

    // Page break vertical: si la fila no entra verticalmente en la página
    if (currentY + rowHeight + innerPaddingMm > blockHeightMm) {
      flushPage();
    }
    // Page break horizontal: si la fila no entra horizontalmente en la
    // página actual (por ejemplo, una pregunta de 8 opciones cuando las
    // anteriores eran de 4 y se alinearon al centro). En ese caso, saltamos
    // a la siguiente página para evitar overflow.
    if (cursorX + rowWidth - innerPaddingMm > blockWidthMm) {
      flushPage();
    }

    const bubbles: BubblePosition[] = [];
    const bubbleDiameter = ANSWER_SHEET_SPEC.bubbleDiameterMm;
    // Centrado horizontal dentro del bloque: cada fila ocupa solo el ancho
    // que necesita según sus columnas, alineada a la izquierda del bloque.
    // Si se prefiere centrado, basta con sumar (usableWidth - rowWidth)/2 al X.
    for (let i = 0; i < q.optionsLength; i++) {
      const letter = OPTION_LETTERS[i] ?? "?";
      const centerX = cursorX + innerPaddingMm + i * ANSWER_SHEET_SPEC.bubbleSpacingMm;
      bubbles.push({
        centerXmm: centerX,
        centerYmm: currentY + rowHeight / 2,
        letter,
      });
    }

    currentPage.rows.push({
      questionNumber: q.number,
      columns: q.optionsLength,
      bubbles,
      widthMm: rowWidth,
    });

    cursorX += rowWidth + rowGapMm;
    // Si la siguiente pregunta no cabe a la derecha de la actual, la
    // siguiente iteración disparará el page break horizontal.
    if (cursorX + innerPaddingMm >= blockWidthMm) {
      cursorX = innerPaddingMm;
      currentY += rowHeight + rowGapMm;
    } else {
      currentY += rowHeight + rowGapMm;
    }
  }

  flushPage();

  return {
    pages,
    totalPages: Math.max(pages.length, 1),
    totalQuestions: questions.length,
  };
}

/** Ancho total de una fila en mm según la cantidad de columnas. */
export function computeRowWidthMm(optionsLength: number, innerPaddingMm: number): number {
  const bubbleDiameter = ANSWER_SHEET_SPEC.bubbleDiameterMm;
  // N burbujas de bubbleDiameter mm centradas en posiciones
  // i * bubbleSpacingMm. La última burbuja termina en (N-1)*spacing +
  // bubbleDiameter. Sumamos 2 * innerPaddingMm porque la fila usa padding
  // izquierdo y derecho al imprimir el bloque.
  const width =
    innerPaddingMm * 2 + (optionsLength - 1) * ANSWER_SHEET_SPEC.bubbleSpacingMm + bubbleDiameter;
  return width;
}

function validateQuestion(q: LayoutQuestion): void {
  if (q.number < 1 || !Number.isInteger(q.number)) {
    throw new Error(`LayoutQuestion.number debe ser entero positivo (recibido ${q.number})`);
  }
  if (
    !Number.isInteger(q.optionsLength) ||
    q.optionsLength < MIN_OPTIONS ||
    q.optionsLength > MAX_OPTIONS
  ) {
    throw new Error(
      `LayoutQuestion.optionsLength debe estar en [${MIN_OPTIONS}, ${MAX_OPTIONS}] (recibido ${q.optionsLength})`,
    );
  }
}
