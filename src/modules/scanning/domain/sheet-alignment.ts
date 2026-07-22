/**
 * Validación de que una hoja escaneada realmente corresponde a la plantilla
 * con la que se la va a calificar.
 *
 * ## Por qué existe
 *
 * El registro por QR siempre "funciona": dados cuatro puntos, el ajuste afín
 * devuelve una transformación con residual bajo aunque la hoja sea de otro
 * formato — el residual solo dice que el QR encaja consigo mismo, no que la
 * rejilla de burbujas encaje.
 *
 * Pasó de verdad: una hoja impresa cuando el reparto de columnas era
 * 40/40/30 se escaneó con el código ya repartiendo 37/37/36. El QR registró
 * con 0.33 px de residual y aun así ninguna burbuja caía donde debía. Sin
 * esta comprobación la hoja se habría calificado 0/110 y guardado como
 * GRADED, que es exactamente el fallo que hay que evitar: un cero silencioso
 * es peor que un error visible, porque nadie lo revisa.
 *
 * ## Cómo valida
 *
 * Las marcas rellenas del estudiante son lo que el detector encuentra de
 * forma fiable (manchas densas y grandes). Si el registro es correcto, casi
 * todas deben caer sobre alguna burbuja de la plantilla. Si un porcentaje
 * alto queda huérfano, la geometría no corresponde.
 *
 * Módulo puro: sin sharp, sin Prisma.
 */

export interface AlignmentInput {
  /** Centros de las marcas detectadas en el escaneo (px). */
  detectedMarks: { cx: number; cy: number }[];
  /** Centros de las burbujas de la plantilla ya llevados al escaneo (px). */
  templateCenters: { x: number; y: number }[];
  /** Diámetro de burbuja en px según el registro. Fija la tolerancia. */
  bubbleDiameterPx: number;
}

export interface AlignmentResult {
  /** Fracción de marcas detectadas que caen sobre una burbuja, 0..1. */
  matchRatio: number;
  /** Distancia mediana de marca a la burbuja más cercana (px). */
  medianDistance: number;
  /** Marcas consideradas. Con muy pocas, el veredicto no es concluyente. */
  sampleSize: number;
  /** `true` si la hoja puede calificarse con esta plantilla. */
  ok: boolean;
  /** Motivo del rechazo, para `AnswerSheet.notes`. */
  reason?: string;
}

/**
 * Umbral de coincidencia. Se exige 0.7 y no 0.95 porque el detector produce
 * algunos falsos positivos legítimos (texto del encabezado, números de
 * pregunta, motas del escáner) que nunca caerán sobre una burbuja. En las
 * medidas reales, una hoja BIEN alineada da >0.9 y la hoja de formato
 * equivocado dio 0.22, así que el umbral separa con holgura.
 */
export const MIN_MATCH_RATIO = 0.7;

/** Mínimo de marcas para que el veredicto sea concluyente. Una hoja casi en
 *  blanco no aporta evidencia; se acepta y el resultado saldrá en blanco,
 *  que es visible y auditable de por sí. */
export const MIN_SAMPLE = 10;

export function checkAlignment(input: AlignmentInput): AlignmentResult {
  const { detectedMarks, templateCenters, bubbleDiameterPx } = input;

  if (templateCenters.length === 0) {
    return {
      matchRatio: 0,
      medianDistance: Infinity,
      sampleSize: 0,
      ok: false,
      reason: "plantilla sin burbujas",
    };
  }
  if (detectedMarks.length < MIN_SAMPLE) {
    // Sin evidencia suficiente: no bloqueamos. Una hoja en blanco es un
    // resultado legítimo y se ve como tal.
    return {
      matchRatio: 1,
      medianDistance: 0,
      sampleSize: detectedMarks.length,
      ok: true,
    };
  }

  const tolerance = bubbleDiameterPx * 0.5;
  const distances: number[] = [];
  let hits = 0;
  for (const m of detectedMarks) {
    let best = Infinity;
    for (const c of templateCenters) {
      const d = Math.hypot(m.cx - c.x, m.cy - c.y);
      if (d < best) best = d;
    }
    distances.push(best);
    if (best <= tolerance) hits++;
  }

  const matchRatio = hits / detectedMarks.length;
  const sorted = [...distances].sort((a, b) => a - b);
  const medianDistance = sorted[Math.floor(sorted.length / 2)] ?? Infinity;

  if (matchRatio < MIN_MATCH_RATIO) {
    return {
      matchRatio,
      medianDistance,
      sampleSize: detectedMarks.length,
      ok: false,
      reason:
        `solo ${(matchRatio * 100).toFixed(0)}% de las marcas caen sobre la rejilla ` +
        `(mínimo ${(MIN_MATCH_RATIO * 100).toFixed(0)}%). La hoja no corresponde a la ` +
        `plantilla: puede haberse impreso con otra versión del formato.`,
    };
  }

  return { matchRatio, medianDistance, sampleSize: detectedMarks.length, ok: true };
}
