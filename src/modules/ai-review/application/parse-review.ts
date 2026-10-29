/**
 * Parseo defensivo de la respuesta del modelo.
 *
 * El modelo puede devolver:
 *  - JSON puro.
 *  - JSON dentro de un bloque ```json ... ```.
 *  - JSON con texto antes/después ("Aquí tienes el análisis: {...}").
 *  - Basura (corte de tokens, HTML, JSON inválido).
 *
 * En todos los casos devolvemos `null` en vez de tirar: quien llama
 * interpreta `null` como "no hubo revisión posible" y deja guardar al
 * docente (la IA es un apoyo, no una puerta que pueda trabar el trabajo).
 */

import {
  AI_REVIEW_AREAS,
  type AiReviewArea,
  type AiReviewCorrection,
  type AiReviewFinding,
  type AiReviewVerdict,
} from "../domain/ai-review";
import { sanitizeAiText } from "./sanitize-text";

const CLAVE_RE = /^[A-H]$/;

/**
 * Limpia el texto del modelo (quita ideogramas y demás caracteres no
 * latinos) y avisa cuando tuvo que hacerlo: si el modelo se pone a
 * escribir en chino, el docente tiene que enterarse por el log, no
 * encontrarse un texto mutilado sin explicación.
 */
function limpiar(texto: string): string {
  const limpio = sanitizeAiText(texto);
  if (limpio !== texto.trim()) {
    console.warn(
      "[ai-review] la respuesta del modelo traía caracteres no latinos (CJK): se eliminaron.",
    );
  }
  return limpio;
}

function normalizarHallazgo(raw: unknown): AiReviewFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const areaRaw = typeof obj.area === "string" ? obj.area.trim().toLowerCase() : "";
  const area: AiReviewArea = (AI_REVIEW_AREAS as readonly string[]).includes(areaRaw)
    ? (areaRaw as AiReviewArea)
    : "enunciado";

  const titulo = typeof obj.titulo === "string" ? limpiar(obj.titulo) : "";
  const justificacion = typeof obj.justificacion === "string" ? limpiar(obj.justificacion) : "";
  const sugerencia = typeof obj.sugerencia === "string" ? limpiar(obj.sugerencia) : "";

  // Sin justificación no hay nada que el docente pueda leer: el hallazgo
  // se descarta (y si era el único, el modelo no está cubriendo el ítem).
  if (!justificacion) return null;

  return {
    area,
    titulo: titulo || "Observación",
    justificacion,
    sugerencia,
  };
}

function normalizarCorreccion(raw: unknown): AiReviewCorrection | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const enunciado = typeof obj.enunciado === "string" ? limpiar(obj.enunciado) : null;
  const clave = typeof obj.clave === "string" ? obj.clave.trim().toUpperCase() : "";
  if (enunciado === null || !CLAVE_RE.test(clave)) return null;

  const opciones: Record<string, string> = {};
  if (obj.opciones && typeof obj.opciones === "object") {
    for (const [k, v] of Object.entries(obj.opciones as Record<string, unknown>)) {
      const key = k.trim().toUpperCase();
      if (CLAVE_RE.test(key) && typeof v === "string") opciones[key] = limpiar(v);
    }
  }

  return { enunciado, opciones, clave };
}

/** Extrae el JSON de una respuesta del modelo. `null` si no hay JSON válido. */
export function parseReviewResponse(raw: string): AiReviewVerdict | null {
  if (!raw || typeof raw !== "string") return null;
  let texto = raw.trim();

  // MiniMax-M3 razonamiento: la respuesta puede venir con un bloque
  // <think>...</think> delante del JSON. Lo quitamos antes de buscar el
  // objeto (si no, un `{` dentro del razonamiento rompería el recorte).
  texto = texto.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const fence = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) texto = fence[1].trim();

  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio === -1 || fin === -1 || fin <= inicio) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const hallazgosRaw = Array.isArray(obj.hallazgos) ? obj.hallazgos : [];
  const hallazgos = hallazgosRaw
    .map(normalizarHallazgo)
    .filter((h): h is AiReviewFinding => h !== null);

  const solucionRaw = typeof obj.solucion === "string" ? obj.solucion.trim().toUpperCase() : "";

  return {
    aprobado: obj.aprobado === true,
    solucion: CLAVE_RE.test(solucionRaw) ? solucionRaw : undefined,
    hallazgos,
    correccion: normalizarCorreccion(obj.correccion),
  };
}
