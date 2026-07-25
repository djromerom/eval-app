/**
 * Plantilla geométrica de una hoja de respuestas: dónde está cada burbuja
 * dentro de la hoja, en coordenadas **normalizadas 0..1** relativas al
 * elemento `.sheet` del render.
 *
 * ## Por qué normalizada y no en mm ni en px
 *
 * Un escaneo puede venir a 150, 200 o 300 DPI, con la hoja desplazada o
 * ligeramente rotada. Guardar píxeles ataría la plantilla a una resolución;
 * guardar mm obligaría a conocer el DPI exacto del escáner. Normalizando
 * contra la propia hoja, el registro (ver `modules/scanning/domain/
 * registration.ts`) solo tiene que resolver la transformación
 * plantilla → escaneo y todo lo demás sale gratis.
 *
 * ## Por qué se MIDE en vez de calcularse
 *
 * La hoja se dibuja con CSS grid (`repeat(3, 1fr)` de columnas, `repeat(8,
 * 1fr)` de opciones, tamaños en `rem` y `mm`). Reimplementar en JS cómo el
 * navegador resuelve eso es exactamente el error que ya cometimos una vez:
 * existía `printing/domain/answer-sheet-layout.ts` calculando posiciones en
 * mm que NADIE usaba, mientras el render real lo hacía el CSS por su cuenta.
 * Las dos fuentes de verdad derivaron y el OMR leía en el vacío.
 *
 * Por eso esta plantilla se captura ejecutando `getBoundingClientRect()`
 * sobre el render real (ver `infrastructure/capture-sheet-geometry.ts`).
 * Si el CSS cambia, la plantilla cambia con él — no pueden desincronizarse.
 */

/** Rectángulo normalizado (0..1) relativo a la hoja. */
export interface NormRect {
  /** Borde izquierdo, fracción del ancho de la hoja. */
  x: number;
  /** Borde superior, fracción del alto de la hoja. */
  y: number;
  /** Ancho, fracción del ancho de la hoja. */
  w: number;
  /** Alto, fracción del alto de la hoja. */
  h: number;
}

/** Centro normalizado de un rectángulo. */
export function centerOf(r: NormRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Una burbuja de la plantilla, ligada a (pregunta global, opción). */
export interface TemplateBubble {
  /** Número global de pregunta en la hoja (1..N). */
  question: number;
  /** Letra de la opción: "A".."H". */
  key: string;
  rect: NormRect;
}

/**
 * Plantilla completa de una hoja. Es función pura del cuadernillo (mismas
 * preguntas ⇒ misma cuadrícula), NO del estudiante: el QR y el nombre
 * cambian por hoja, pero la rejilla de burbujas es idéntica. Por eso se
 * cachea una vez por `bundleId`.
 */
export interface SheetTemplate {
  /** Versión del formato, para invalidar cachés si cambia el esquema. */
  version: 1;
  /** Relación de aspecto de la hoja (ancho/alto) — sanity check del registro. */
  aspectRatio: number;
  /** Rect del elemento `<img>` del QR (incluye zona de silencio). */
  qr: NormRect;
  /**
   * Finder patterns del QR en coordenadas normalizadas de la hoja.
   *
   * Son el ancla del registro. Se detectan corriendo el MISMO decodificador
   * sobre una captura de pantalla de la plantilla que luego se corre sobre
   * el escaneo, así que la correspondencia es punto-a-punto y no depende de
   * suponer la versión del QR ni el ancho de su zona de silencio (el rect
   * del `<img>` incluye margen blanco; los finder patterns no).
   *
   * Vacío si la detección falló al capturar: en ese caso el registro cae a
   * un ajuste por relación de aspecto, menos preciso.
   */
  qrFinders: { x: number; y: number }[];
  bubbles: TemplateBubble[];
}

/** Índice (pregunta, key) → burbuja, para muestreo rápido. */
export function indexTemplate(t: SheetTemplate): Map<string, TemplateBubble> {
  const m = new Map<string, TemplateBubble>();
  for (const b of t.bubbles) m.set(bubbleKey(b.question, b.key), b);
  return m;
}

export function bubbleKey(question: number, key: string): string {
  return `${question}:${key}`;
}
