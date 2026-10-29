/**
 * Limpieza del texto que devuelve el modelo.
 *
 * MiniMax-M3 se le escapan caracteres de otros alfabetos (por ejemplo
 * ideogramas chinos) dentro de las justificaciones, los títulos o las
 * opciones corregidas. Al docente le llega texto que no puede leer, y
 * si lo copia al ítem queda contaminado.
 *
 * Solo se borran los rangos CJK (ideogramas, kana, hangul, formas de
 * ancho completo). El español, los acentos, los símbolos matemáticos
 * (α, ∑, π…) y el LaTeX se dejan intactos: en un ítem de matemáticas
 * el alfabeto griego es legítimo.
 */

/**
 * Rangos CJK / kana / hangul / formas de ancho completo:
 *  - U+1100-U+11FF  hangul jamo
 *  - U+2E80-U+2EFF  radicals CJK
 *  - U+3000-U+303F  signos de puntuación CJK
 *  - U+3040-U+30FF  hiragana + katakana
 *  - U+3130-U+318F  hangul compatible
 *  - U+3400-U+4DBF  ideogramas extensión A
 *  - U+4E00-U+9FFF  ideogramas CJK unificados
 *  - U+A960-U+A97F  hangul jamo extendido A
 *  - U+AC00-U+D7FF  hangul sílabas
 *  - U+F900-U+FAFF  ideogramas de compatibilidad
 *  - U+FE30-U+FE4F  formas de compatibilidad CJK
 *  - U+FF00-U+FFEF  formas de ancho completo
 */
const CJK_RE =
  /[\u1100-\u11FF\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7FF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/g;

/** ¿El texto tiene caracteres de alfabetos no latinos? */
export function tieneCaracteresNoLatinos(text: string): boolean {
  if (!text) return false;
  return new RegExp(CJK_RE.source).test(text);
}

/**
 * Quita los caracteres no latinos y arregla los espacios que quedan
 * sueltos (p. ej. "se debe求解." → "se debe.").
 */
export function sanitizeAiText(text: string): string {
  if (!text) return text;
  return text
    .replace(CJK_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .trim();
}
