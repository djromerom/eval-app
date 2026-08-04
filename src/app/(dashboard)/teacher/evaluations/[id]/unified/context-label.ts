/**
 * Helper puro para etiquetar el contexto de un ítem en la tabla resumen del
 * editor unificado. Devuelve el TIPO del contexto ("Comun" / "Especifico" /
 * "Ninguno") más el TÍTULO de la sección (truncado a `maxTitleChars` para que
 * la celda no rompa el layout de la tabla).
 *
 * Reglas (decisión del mockup):
 *  - "Ninguno" si la sección no existe, o si existe pero NO tiene título y
 *    NO tiene contenido.
 *  - "Especifico" si la sección tiene título (independiente del contenido).
 *  - "Comun" si la sección tiene contenido Y el conjunto de secciones con
 *    título + contenido acumula >= 2 preguntas (heurística: si varias
 *    preguntas comparten un contexto "rico", se considera común).
 *
 * Si tras smoke se ve que la heurística no calza con la realidad, se itera
 * con metadatos reales. Por ahora es trivial y testeable.
 */

export interface SectionLite {
  id: string;
  title: string | null;
  content: unknown;
  questions: { id: string }[];
}

export interface QuestionLite {
  id: string;
  sectionId: string;
}

export type ContextKind = "Comun" | "Especifico" | "Ninguno";

export interface ContextInfo {
  kind: ContextKind;
  /** Título de la sección truncado a `maxTitleChars`. Null si la sección
   *  no tiene título (la celda mostrará "Sin título"). */
  title: string | null;
  /** `true` si el texto fue truncado por alcanzar el límite. */
  truncated: boolean;
}

const DEFAULT_MAX_TITLE = 50;

/**
 * Etiqueta visible del contexto para una pregunta concreta en la tabla resumen.
 *
 * @param question pregunta a etiquetar
 * @param sections todas las secciones de la evaluación
 * @param maxTitleChars largo máximo del título a devolver (default 50)
 */
export function contextLabel(
  question: QuestionLite,
  sections: SectionLite[],
  maxTitleChars: number = DEFAULT_MAX_TITLE,
): ContextInfo {
  const section = sections.find((s) => s.id === question.sectionId);
  if (!section) return { kind: "Ninguno", title: null, truncated: false };

  const hasTitle = !!(section.title && section.title.trim().length > 0);

  // La decisión es por la presencia de TÍTULO, no de contenido: una sección
  // "vacía" auto-creada (sin título, sin contenido) — o con solo un cuerpo
  // de TipTap sin encabezado — no cuenta como contexto. El docente debe
  // ponerle título para que el ítem aparezca como "Especifico" / "Comun".
  let kind: ContextKind;
  if (!hasTitle) {
    kind = "Ninguno";
  } else if (section.questions.length >= 2) {
    kind = "Comun";
  } else {
    kind = "Especifico";
  }

  const raw = (section.title ?? "").trim();
  if (raw.length === 0) return { kind, title: null, truncated: false };
  if (raw.length <= maxTitleChars) {
    return { kind, title: raw, truncated: false };
  }
  // Cortamos en el último espacio DENTRO del límite para no romper palabras
  // a la mitad (UX: "Para resolver un sistema…" se lee mejor que "Para
  // resolver un sistema de e…"). Si el último espacio está demasiado cerca
  // del inicio (palabra única muy larga), caemos al corte duro.
  const candidate = raw.slice(0, maxTitleChars);
  const lastSpace = candidate.lastIndexOf(" ");
  const safe = lastSpace > maxTitleChars * 0.5 ? candidate.slice(0, lastSpace) : candidate;
  return { kind, title: safe.trimEnd() + "…", truncated: true };
}
