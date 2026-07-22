import type { DetectedBubble } from "./bubble-detector";

/** Centro mapeado a una celda del grid inferido. Las coords son las del
 *  detector (originales post upscale desde downsampled). */
export interface GridCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pregunta con sus 8 (o N) burbujas ordenadas por X (A→H). */
export interface GriddedQuestion {
  /** Opciones de la pregunta ordenadas por X. Típicamente 8 (A–H) o
   *  menos si la pregunta tiene optionsLength < 8. */
  cells: GridCell[];
}

/** Resultado de la inferencia. Si `ok=false`, el lector debe caer al
 *  layout calibrado hardcodeado (`BUNDLE_BUBBLE_LAYOUT`). */
export interface GridInferenceResult {
  ok: boolean;
  /** Una entrada por pregunta del QR (en orden de numeración global 1..N).
   *  Vacío si `ok=false`. */
  questions: GriddedQuestion[];
  /** Razón de fallo si `ok=false` (para `notes` del AnswerSheet). */
  reason?: string;
  /** Cuántas columnas X encontró (típicamente 8; usado por la UI). */
  cols: number;
}

export interface InferGridInput {
  bubbles: DetectedBubble[];
  /** Cantidad esperada de preguntas (del answer key). */
  expectedQuestions: number;
  /** Cantidad esperada de columnas (= opciones por fila, típicamente 8). */
  expectedCols: number;
}

/** Infiere el grid OMR a partir de las burbujas detectadas.
 *
 *  Algoritmo (Sprint 9):
 *  1. **Split X-first** en bandas verticales usando greedy gap detection
 *     (gap > 1.5 × medianSpacingX = nueva banda). En bundle 3-col se
 *     forman naturalmente 3 bandas; en legacy 1-col, 1 banda.
 *  2. **Dentro de cada banda**: split Y en filas (mismo criterio de gap).
 *  3. Cada fila → sus celdas ordenadas por X (las `expectedCols` primeras).
 *  4. Validación: `Σ rows × colsPerRow ≥ 0.8 × expectedQuestions × expectedCols`.
 *  5. Mapeo band-by-band left-to-right, top-to-bottom dentro de cada banda.
 *     Esto reproduce el orden del render CSS (`splitIntoColumns` en
 *     `print/answer-sheets/bundle/[id]/page.tsx`).
 *
 *  Si en cualquier paso la validación falla, retorna `ok=false` con la
 *  razón para que el caller caiga al layout calibrado. */
export function inferGrid(input: InferGridInput): GridInferenceResult {
  const { bubbles, expectedQuestions, expectedCols } = input;

  if (bubbles.length === 0) {
    return { ok: false, questions: [], cols: expectedCols, reason: "no bubbles detected" };
  }
  if (expectedQuestions <= 0 || expectedCols <= 0) {
    return { ok: false, questions: [], cols: expectedCols, reason: "invalid expected counts" };
  }

  // Escala de referencia: tamaño mediano de burbuja. TODOS los umbrales de
  // clustering se derivan de aquí y NO de la mediana de gaps — ver el
  // comentario de `clusterByAxis` para por qué la mediana de gaps se rompe
  // en escaneos reales.
  const medianW = median(bubbles.map((b) => b.w));
  const medianH = median(bubbles.map((b) => b.h));

  // 1) Split X-first en bandas verticales. Dentro de una banda, dos opciones
  //    contiguas distan ~1.5–2 diámetros; el canal entre bandas es mucho
  //    mayor. 3 diámetros separa sin partir opciones.
  const bandsRaw = clusterByAxis(bubbles, "cx", medianW * 3);
  if (bandsRaw.length === 0) {
    return { ok: false, questions: [], cols: expectedCols, reason: "no bands formed" };
  }

  // 2-3) Dentro de cada banda: split por Y en filas. Dentro de una fila los
  //    centros comparten Y salvo jitter (<0.5 diámetro); entre filas el
  //    salto es ~1.5 diámetros. 0.8 diámetros separa limpio.
  const bands: GridCell[][][] = bandsRaw.map((band) => {
    const rowsRaw = clusterByAxis(band, "cy", medianH * 0.8);
    return rowsRaw
      .filter((r) => r.length >= 2)
      .map((row) =>
        [...row].sort((a, b) => a.cx - b.cx).map((b) => ({ x: b.cx, y: b.cy, w: b.w, h: b.h })),
      );
  });

  const totalRows = bands.reduce((acc, b) => acc + b.length, 0);
  if (totalRows === 0) {
    return { ok: false, questions: [], cols: expectedCols, reason: "no rows in bands" };
  }

  // 4) Validación. Usa la MODA del colsPerRow (no el max) para detectar
  //    filas inconsistentes: si la mayoría tiene `expectedCols` pero hay
  //    outliers cortos, deben disparar el fallback.
  const allRowLengths = bands.flat().map((r) => r.length);
  const lengthCounts = new Map<number, number>();
  for (const len of allRowLengths) {
    lengthCounts.set(len, (lengthCounts.get(len) ?? 0) + 1);
  }
  const modeEntry = [...lengthCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const colsPerRow = modeEntry?.[0] ?? 0;
  const modeCount = modeEntry?.[1] ?? 0;
  const matchRatio = totalRows > 0 ? modeCount / totalRows : 0;

  if (colsPerRow < expectedCols) {
    return {
      ok: false,
      questions: [],
      cols: expectedCols,
      reason: `insufficient columns per row (mode=${colsPerRow}, expected=${expectedCols})`,
    };
  }
  if (matchRatio < 0.8) {
    return {
      ok: false,
      questions: [],
      cols: expectedCols,
      reason: `inconsistent columns per row (mode=${colsPerRow}, match=${(matchRatio * 100).toFixed(0)}%)`,
    };
  }
  if (totalRows * colsPerRow < expectedQuestions * colsPerRow * 0.8) {
    // Heurística: necesitamos cubrir ≥80% del total esperado contando solo
    // filas con colsPerRow canónico.
    return {
      ok: false,
      questions: [],
      cols: expectedCols,
      reason: `insufficient canonical rows×cols (${modeCount * colsPerRow} < ${expectedQuestions * expectedCols * 0.8})`,
    };
  }

  // 5) Mapeo band-by-band left-to-right, top-to-bottom dentro de banda.
  const questions: GriddedQuestion[] = [];
  for (const band of bands) {
    for (const row of band) {
      if (questions.length >= expectedQuestions) break;
      questions.push({ cells: row.slice(0, expectedCols) });
    }
    if (questions.length >= expectedQuestions) break;
  }

  if (questions.length !== expectedQuestions) {
    return {
      ok: false,
      questions: [],
      cols: expectedCols,
      reason: `mapped ${questions.length} questions, expected ${expectedQuestions}`,
    };
  }

  return { ok: true, questions, cols: colsPerRow };
}

/** Clusteriza una lista de burbujas por un eje (cx o cy) usando greedy gap
 *  detection: dos elementos contiguos caen en el mismo cluster si su
 *  diferencia en ese eje es ≤ `gapThreshold` (en píxeles absolutos).
 *
 *  **El umbral se pasa en píxeles, derivado del tamaño de burbuja — NO de
 *  la mediana de los gaps.** Una versión anterior calculaba
 *  `median(gaps) × factor` y funcionaba con grids sintéticos pero fallaba
 *  con escaneos reales: en un grid sintético las burbujas de una misma
 *  columna comparten `cx` exacto, así que los únicos gaps no-cero son los
 *  espaciados reales y la mediana es correcta. En un escaneo real hay
 *  jitter de ±2–3 px, la lista ordenada se llena de gaps diminutos, la
 *  mediana colapsa a ~2 px y el umbral resultante parte cada columna de
 *  opciones en su propia banda (síntoma observado: `colsPerRow` moda = 2
 *  en vez de 8). El diámetro de burbuja es una escala estable que no
 *  depende de la distribución de gaps. */
function clusterByAxis(
  bubbles: DetectedBubble[],
  axis: "cx" | "cy",
  gapThreshold: number,
): DetectedBubble[][] {
  if (bubbles.length === 0) return [];
  const threshold = Math.max(4, gapThreshold);
  const sorted = [...bubbles].sort((a, b) => a[axis] - b[axis]);

  const clusters: DetectedBubble[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1]!;
    const gap = sorted[i]![axis] - last[last.length - 1]![axis];
    if (gap <= threshold) {
      last.push(sorted[i]!);
    } else {
      clusters.push([sorted[i]!]);
    }
  }
  return clusters;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
