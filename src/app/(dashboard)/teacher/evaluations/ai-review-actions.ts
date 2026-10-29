"use server";

/**
 * Revisión de ítems con IA — server action.
 *
 * Es la única pieza que habla con MiniMax. Recibe el contenido CRUDO del
 * formulario (los valores de los hidden inputs del RichTextEditor: JSON de
 * TipTap o texto plano) y devuelve:
 *
 *  - `null` → no hubo revisión posible (IA no configurada, error del
 *    proveedor, respuesta no parseable). El docente guarda igual: la IA
 *    es un apoyo, nunca una puerta que trabe el trabajo.
 *  - un objeto con el veredicto y, si la IA propuso corrección, el ítem
 *    corregido YA en TipTap (con las fórmulas e imágenes originales
 *    re-inyectadas en su lugar).
 */

import { requireAuthenticatedUser } from "@/lib/session";
import {
  createProtectedRegistry,
  extractProtectedText,
  rebuildProtectedDoc,
  tokensIn,
} from "@/modules/ai-review/application/protected-content";
import type { AiReviewFinding } from "@/modules/ai-review/domain/ai-review";
import { makeReviewItem } from "@/modules/ai-review/infrastructure/container";

export interface AiReviewRequest {
  /** Contexto vigente (opcional). `contenido` es el valor crudo del editor. */
  contexto: { titulo: string; contenido: string } | null;
  /** Enunciado crudo (JSON de TipTap o texto plano). */
  enunciado: string;
  /** Opciones crudas, en orden de clave. */
  opciones: { key: string; valor: string }[];
  /** Clave marcada por el docente. */
  clave: string;
}

export interface AiReviewCorrectionPayload {
  /** Enunciado corregido (documento TipTap). */
  enunciado: unknown;
  /** Clave → valor corregido (documento TipTap o texto plano). */
  opciones: Record<string, unknown>;
  /** Clave corregida. */
  clave: string;
}

export interface AiReviewResponse {
  aprobado: boolean;
  hallazgos: AiReviewFinding[];
  correccion: AiReviewCorrectionPayload | null;
}

/** Convierte el valor crudo de un editor (JSON o texto) en algo que se pueda recorrer. */
function parseDoc(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export async function reviewItemAction(request: AiReviewRequest): Promise<AiReviewResponse | null> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  const useCase = makeReviewItem();
  if (!useCase) {
    console.warn("[ai-review] MINIMAX_API_KEY no configurada — el ítem se guarda sin revisar.");
    return null;
  }

  const registry = createProtectedRegistry();

  // Contexto (opcional). Solo se REVISA: la IA no lo corrige (el docente
  // decide si lo reescribe), así que no hace falta reconstruirlo.
  const contextoDoc = parseDoc(request.contexto?.contenido);
  const contextoTexto = contextoDoc ? extractProtectedText(contextoDoc, registry) : "";

  // Enunciado.
  const enunciadoDoc = parseDoc(request.enunciado);
  const enunciadoTexto = enunciadoDoc ? extractProtectedText(enunciadoDoc, registry) : "";
  const enunciadoTokens = tokensIn(enunciadoTexto);

  // Opciones: guardamos el valor crudo para saber si era texto plano o doc.
  const opciones = request.opciones.map((opcion) => {
    const doc = parseDoc(opcion.valor);
    const texto = doc ? extractProtectedText(doc, registry) : "";
    return {
      key: opcion.key,
      texto,
      tokens: tokensIn(texto),
      eraDoc: typeof doc === "object" && doc !== null,
    };
  });

  const result = await useCase.execute({
    actor,
    item: {
      contexto: request.contexto ? { titulo: request.contexto.titulo, texto: contextoTexto } : null,
      enunciado: enunciadoTexto,
      opciones: opciones.map((o) => ({ key: o.key, texto: o.texto })),
      clave: request.clave,
      protegidos: registry.elementos.map((e) => ({
        token: e.token,
        tipo: e.tipo,
        contexto: e.contexto,
      })),
    },
  });

  if (!result.ok) {
    console.error(`[ai-review] ${result.error.code}: ${result.error.message}`);
    return null;
  }

  const verdict = result.value;
  if (verdict.aprobado) {
    return { aprobado: true, hallazgos: [], correccion: null };
  }

  const correccionCruda = verdict.correccion;
  let correccion: AiReviewCorrectionPayload | null = null;

  if (correccionCruda) {
    const clavesValidas = new Set(opciones.map((o) => o.key));
    if (!clavesValidas.has(correccionCruda.clave)) {
      console.warn(
        `[ai-review] la IA propuso la clave "${correccionCruda.clave}" que no existe entre las opciones — se ignora la corrección automática.`,
      );
    } else {
      // Si la IA no cambió el texto, conservamos el documento ORIGINAL
      // (con su formato: negritas, alineación, etc.) en vez de
      // reconstruirlo desde el texto plano.
      const enunciadoCorregido = !correccionCruda.enunciado.trim()
        ? enunciadoDoc
        : correccionCruda.enunciado.trim() === enunciadoTexto.trim()
          ? enunciadoDoc
          : rebuildProtectedDoc(correccionCruda.enunciado, registry, enunciadoTokens);

      const opcionesCorregidas: Record<string, unknown> = {};
      for (const opcion of opciones) {
        const original = parseDoc(request.opciones.find((o) => o.key === opcion.key)?.valor ?? "");
        const textoNuevo = correccionCruda.opciones[opcion.key];
        if (typeof textoNuevo !== "string" || !textoNuevo.trim()) {
          // La IA no devolvió esta opción → se conserva la original.
          opcionesCorregidas[opcion.key] = original;
          continue;
        }
        if (!opcion.eraDoc) {
          opcionesCorregidas[opcion.key] = textoNuevo;
          continue;
        }
        opcionesCorregidas[opcion.key] =
          textoNuevo.trim() === opcion.texto.trim()
            ? original
            : rebuildProtectedDoc(textoNuevo, registry, opcion.tokens);
      }

      correccion = {
        enunciado: enunciadoCorregido,
        opciones: opcionesCorregidas,
        clave: correccionCruda.clave,
      };
    }
  }

  return {
    aprobado: false,
    hallazgos: verdict.hallazgos,
    correccion,
  };
}
