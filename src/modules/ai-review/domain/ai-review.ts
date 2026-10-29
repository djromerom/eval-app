/**
 * Revisión de ítems con IA (MiniMax).
 *
 * El docente termina de formular una pregunta (contexto + enunciado +
 * opciones + clave) y, al guardar, la IA revisa el ítem antes de dejarlo
 * pasar. Si todo está bien → se guarda sin más. Si hay hallazgos → se
 * muestra una modal con la justificación de cada problema y tres salidas:
 * guardar igual, corregir automáticamente o cancelar.
 *
 * La revisión es TEXTUAL: la IA ve el enunciado y las opciones como texto
 * plano. Las fórmulas LaTeX y las imágenes NO se revisan ni se corrigen
 * (ver `application/protected-content.ts`): se extraen del documento y se
 * re-inyectan tal cual al aplicar la corrección.
 *
 * Reglas de la capa de dominio (no se importa @prisma/client):
 * - El módulo no persiste nada: la revisión es un servicio sin estado.
 * - El puerto `AiItemReviewer` permite cambiar de proveedor (MiniMax hoy)
 *   sin tocar la capa de aplicación.
 * - Errores legibles vía `Result<T>` (nunca throw para errores de negocio).
 */

export const AI_REVIEW_AREAS = ["clave", "enunciado", "opciones", "contexto"] as const;

export type AiReviewArea = (typeof AI_REVIEW_AREAS)[number];

/** Una observación de la IA sobre el ítem. */
export interface AiReviewFinding {
  /** Zona del ítem observada. */
  area: AiReviewArea;
  /** Título corto de la observación (p.ej. "La clave no corresponde"). */
  titulo: string;
  /** POR QUÉ está mal — es lo que el docente necesita leer. */
  justificacion: string;
  /** Qué corregir (sugerencia concreta de la IA). */
  sugerencia: string;
}

/** Versión corregida del ítem, tal como la devuelve la IA. */
export interface AiReviewCorrection {
  /** Enunciado corregido (texto plano; puede traer marcadores protegidos). */
  enunciado: string;
  /** Clave → texto plano corregido de cada opción. */
  opciones: Record<string, string>;
  /** Clave corregida ("A".."H"). */
  clave: string;
}

/** Veredicto de la IA sobre el ítem. */
export interface AiReviewVerdict {
  /** `true` → el ítem pasa sin observaciones. */
  aprobado: boolean;
  /** Clave que la IA obtuvo al RESOLVER el ítem por su cuenta.
   *  Es la que contrasta con la clave del docente: si difieren, la clave
   *  del docente está mal, aunque la IA se haya aprobado sin querer. */
  solucion?: string;
  /** Observaciones encontradas (vacío si aprobó). */
  hallazgos: AiReviewFinding[];
  /** Versión corregida del ítem (`null` si la IA no propuso corrección). */
  correccion: AiReviewCorrection | null;
}

/**
 * Elemento que la IA no debe tocar (fórmula, imagen, tabla, lista) con el
 * contexto legible para que pueda entender de qué se trata sin reescribirlo.
 */
export interface AiProtectedElement {
  /** Marcador que aparece en el texto que ve la IA: ⟦F1⟧, ⟦I1⟧, ⟦B1⟧. */
  token: string;
  /** "formula" | "imagen" | "bloque". */
  tipo: "formula" | "imagen" | "bloque";
  /** Contexto legible (LaTeX de la fórmula, alt de la imagen, texto del bloque). */
  contexto: string;
}

/** Contenido del ítem que se manda a revisar. */
export interface AiReviewInput {
  /** Contexto (opcional): título + texto plano. */
  contexto: { titulo: string; texto: string } | null;
  /** Enunciado en texto plano. */
  enunciado: string;
  /** Opciones en texto plano, en orden de clave. */
  opciones: { key: string; texto: string }[];
  /** Clave marcada por el docente. */
  clave: string;
  /** Elementos protegidos (fórmulas/imágenes) con su contexto. */
  protegidos: AiProtectedElement[];
}

/**
 * Puerto del proveedor de IA. La capa de aplicación solo conoce esta
 * interfaz; la infraestructura la implementa con MiniMax.
 */
export interface AiItemReviewer {
  review(input: AiReviewInput): Promise<AiReviewVerdict>;
}
