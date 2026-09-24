/**
 * Puerto de detección OMR. La implementación (infraestructura) delega en el
 * microservicio Python (`omr-service`, FastAPI) que corre el motor de visión
 * validado. El dominio/aplicación solo conocen esta interfaz — sin `fetch`,
 * sin detalles de transporte.
 *
 * El contrato refleja 1:1 la salida de `build_sheet_data` del servicio:
 *   { thr, questions: [ { n, ans, fills: [ {l,f,m,x,y,r} ], crop } ] }
 */

/** Una burbuja detectada de una pregunta. `x,y,r` en píxeles de la imagen
 *  original (para reconstruir la bbox); `f` = ratio de relleno 0..1; `m` =
 *  marcada según el umbral adaptativo del motor. */
export interface DetectedBubble {
  /** Letra de la opción, "A".."H". */
  l: string;
  /** Fill ratio 0..1. */
  f: number;
  /** Marcada (decisión del motor con su umbral adaptativo). */
  m: boolean;
  x: number;
  y: number;
  r: number;
}

export interface DetectedQuestion {
  /** Número de pregunta 1-based, en orden de detección (top→bottom). */
  n: number;
  /** Respuesta detectada: "A".."H" | "BLANCO" | "MULTIPLE:XY". */
  ans: string;
  fills: DetectedBubble[];
  /** Recorte JPEG en base64 con las burbujas dibujadas (para el visor). */
  crop: string;
}

export interface DetectedSheet {
  /** Umbral de marcado adaptativo que usó el motor para esta hoja. */
  thr: number;
  questions: DetectedQuestion[];
  /** Recorte JPEG en base64 del bloque Nombre/Grado/Código impreso en la hoja.
   *  Solo viene cuando el QR NO se pudo leer: en ese caso la hoja llega sin
   *  estudiante y alguien tiene que identificarla a mano, y este recorte evita
   *  abrir el escaneo original. Cadena vacía cuando el QR se leyó bien. */
  idCrop?: string;
  /** Código del estudiante leído por OCR del recorte anterior, como SUGERENCIA
   *  a confirmar por una persona. Nunca reemplaza al QR, y es `null` si el OCR
   *  no está disponible o no encontró un número plausible. */
  idOcr?: string | null;
  /** Avisos de la verificación estructural del motor (`check_structure`):
   *  huecos entre filas, bloques con distinta cantidad de filas. Es la red
   *  contra la falla silenciosa: cuando se pierde una fila y aparece otra
   *  espuria, el conteo cuadra con la clave y la lectura sale completa y
   *  verosímil pero con la numeración corrida. Vacío = sin sospechas. */
  estructura?: string[];
}

export interface OmrDetector {
  /** Corre el motor OMR sobre la imagen y devuelve las respuestas detectadas.
   *  Lanza si el servicio no responde o la hoja es ilegible; el use case lo
   *  traduce a estado REVIEW. */
  analyze(image: Buffer, opts?: { letters?: string }): Promise<DetectedSheet>;
}
