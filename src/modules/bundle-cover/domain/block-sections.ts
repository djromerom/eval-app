/**
 * Block visibility helpers para el Cover Studio (ago 2026).
 * ==========================================================
 *
 * El Studio permite al docente apagar/prender bloques estructurales del HTML
 * de portada (instrucciones, callout, ¿cómo marcar?, prohibido, pie legal) sin
 * tocar el editor de HTML. Cada bloque se identifica por un ID estable que
 * el render del Studio usa para saber qué strip/restaurar.
 *
 * Mecánica:
 *   • Para bloques basados en SECCIÓN Mustache (`itemsBefore`, `callout`,
 *     `itemsAfter`) strippear la sección es trivial — la delimitamos por
 *     `{{#X}}...{{/X}}` y no hay ambigüedad.
 *   • Para bloques basados en ELEMENTOS del DOM (cómo marcar, prohibido) y
 *     para valores sueltos (`legalFooter`), la plantilla built-in lleva
 *     marcadores HTML comment `<!--STUDIO-BLOCK:ID:START-->...<!--STUDIO-BLOCK:ID:END-->`
 *     que delimitan exactamente el bloque. Strip = reemplazar el rango por
 *     `{{!stripped:ID}}`; restore = volver a poner el rango original
 *     (extraído del built-in) en lugar del marker.
 *
 * Los marcadores son HTML comments, así que son invisibles al render y al
 * DOMPurify. Si el docente edita el HTML en cover-designer y borra un
 * marcador accidentalmente, el toggle correspondiente queda sin efecto (no
 * rompe nada — solo el toggle deja de ser reversible para ese bloque).
 *
 * Tests: `tests/unit/block-sections.test.ts`.
 */

import { type CoverTemplateKey } from "./cover-template";

/**
 * IDs estables de los bloques que el Studio puede togglear. Se serializan
 * en el HTML como `{{!stripped:ID}}` y en el cover-studio-form como
 * checkboxes con name=`block.<id>`.
 */
export const STUDIO_BLOCK_IDS = [
  "itemsBefore",
  "callout",
  "howToMark",
  "itemsAfter",
  "prohibited",
  "legalFooter",
] as const;

export type StudioBlockId = (typeof STUDIO_BLOCK_IDS)[number];

/**
 * Estado de visibilidad por bloque. `true` = el bloque está presente en el
 * HTML renderizado; `false` = fue strippeado y la sección vale `{{!stripped:ID}}`.
 */
export type StudioBlockState = Record<StudioBlockId, boolean>;

/** Estado "todo prendido" — útil para inicializar la UI y para el reset. */
export function allBlocksOn(): StudioBlockState {
  return Object.fromEntries(STUDIO_BLOCK_IDS.map((id) => [id, true])) as StudioBlockState;
}

// ===========================================================================
// Marcadores en la plantilla
// ===========================================================================

/** Formato del marker START: `<!--STUDIO-BLOCK:ID:START-->`. */
function startMarker(id: StudioBlockId): string {
  return `<!--STUDIO-BLOCK:${id}:START-->`;
}

/** Formato del marker END: `<!--STUDIO-BLOCK:ID:END-->`. */
function endMarker(id: StudioBlockId): string {
  return `<!--STUDIO-BLOCK:${id}:END-->`;
}

/** Marker Mustache que queda en el HTML cuando un bloque está apagado. */
const STRIPPED_MARKER = (id: StudioBlockId) => `{{!stripped:${id}}}`;

/**
 * Regex que matchea un bloque con marcadores START/END. El contenido
 * intermedio se captura en el grupo 2 (entre START y END) para que
 * `restoreBlockSection` pueda volver a ponerlo literal.
 */
function markerBlockRegex(id: StudioBlockId): RegExp {
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(${escaped(startMarker(id))})([\\s\\S]*?)(${escaped(endMarker(id))})`, "g");
}

// ===========================================================================
// Secciones Mustache (sin marcadores — basta con la regex de la sección)
// ===========================================================================

interface SectionDef {
  /** Path de la sección (sin `#`). Usado en `{{#path}}` y `{{/path}}`. */
  open: string;
}

const SECTION_BLOCKS: Partial<Record<StudioBlockId, SectionDef>> = {
  itemsBefore: { open: "cover.instructions.items" },
  callout: { open: "cover.callout.text" },
  itemsAfter: { open: "cover.instructions.itemsAfter" },
};

/**
 * Regex que matchea una sección Mustache entera. La sección puede contener
 * saltos de línea, así que `[\s\S]*?` es necesario (`.` no matchea `\n`).
 *
 * NOTA sobre el patrón `}` final: el `}}` literal requiere escape solo del
 * carácter `}` (no de `{`). Para mantenerlo simple usamos una clase de
 * caracteres.
 */
function mustacheSectionRegex(open: string): RegExp {
  const escaped = open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\{\\{#${escaped}\\}\\}[\\s\\S]*?\\{\\{/${escaped}\\}\\}`, "g");
}

// ===========================================================================
// API pública
// ===========================================================================

/**
 * Identifica qué bloques del Studio están actualmente presentes en el HTML
 * (es decir, NO fueron strippeados antes). Sirve para inicializar el estado
 * de los checkboxes al abrir la página.
 *
 * Si un bloque tiene marcador de sección (presente) → true.
 * Si tiene marcador de strip (`{{!stripped:ID}}`) → false.
 * Si NO aparece en el HTML en absoluto → false (aún no se ha restaurado
 * desde el built-in; el toggle ON insertará el bloque desde built-in).
 */
export function identifyActiveBlocks(html: string): StudioBlockState {
  const state = allBlocksOn();

  for (const id of STUDIO_BLOCK_IDS) {
    // ¿Está strippeado?
    if (html.includes(STRIPPED_MARKER(id))) {
      state[id] = false;
      continue;
    }
    // ¿Aparece el bloque en el HTML (sección o marcador START)?
    const section = SECTION_BLOCKS[id];
    if (section) {
      const re = mustacheSectionRegex(section.open);
      state[id] = re.test(html);
    } else {
      // Bloques con marcadores HTML
      state[id] = html.includes(startMarker(id));
    }
  }

  return state;
}

/**
 * Aplica el estado de bloques deseado sobre el HTML actual. Es idempotente:
 * si un bloque ya está en el estado deseado, no se modifica.
 *
 *   • `state[id] === true`  y bloque strippeado → restaurar desde builtin.
 *   • `state[id] === false` y bloque presente   → reemplazar por `{{!stripped:ID}}`.
 *   • `state[id] === true`  y bloque ausente    → insertar desde builtin
 *     en la posición del marker (si existe) o no hacer nada (el docente
 *     tendrá que agregarlo manualmente — solo ocurre con HTML custom sin
 *     marcadores).
 *
 * `builtinBody` se usa como fuente de verdad para restaurar bloques. Si el
 * HTML del usuario no tiene marcador de strip pero el estado dice "off",
 * strippeamos el bloque "en sitio" (buscando la sección o los markers en
 * el HTML actual). Si el estado dice "on" pero el HTML no tiene marker de
 * strip ni el bloque presente, no hacemos nada (no podemos inventarnos la
 * posición de inserción).
 */
export function applyBlockState(
  html: string,
  desired: StudioBlockState,
  builtinBody: string,
): string {
  let out = html;
  for (const id of STUDIO_BLOCK_IDS) {
    const want = desired[id];
    const stripped = out.includes(STRIPPED_MARKER(id));

    if (want && stripped) {
      // Restaurar desde built-in
      out = restoreFromBuiltin(out, id, builtinBody);
      continue;
    }

    if (!want && !stripped) {
      // Strip en sitio
      out = stripInPlace(out, id);
      continue;
    }

    // Si `want && !stripped` y el bloque no aparece, no podemos hacer nada
    // sin conocer la posición. Idem para `!want && stripped` (caso patológico).
  }
  return out;
}

// ===========================================================================
// Strip / restore
// ===========================================================================

/**
 * Reemplaza el bloque en su forma presente por el marker `{{!stripped:ID}}`.
 * Si el bloque no aparece en `html`, no modifica nada.
 */
function stripInPlace(html: string, id: StudioBlockId): string {
  const section = SECTION_BLOCKS[id];
  if (section) {
    const re = mustacheSectionRegex(section.open);
    return html.replace(re, STRIPPED_MARKER(id));
  }
  // Bloques con marcadores HTML
  const re = markerBlockRegex(id);
  return html.replace(re, STRIPPED_MARKER(id));
}

/**
 * Restaura un bloque strippeado desde el built-in. Si el marker
 * `{{!stripped:ID}}` no aparece en `html`, no modifica nada.
 *
 * Si el bloque en el built-in tiene marcadores, los extrae. Si no, y es
 * sección, extrae la sección. Si no, no se puede restaurar (devuelve html
 * sin cambios).
 */
function restoreFromBuiltin(html: string, id: StudioBlockId, builtin: string): string {
  const stripped = STRIPPED_MARKER(id);
  if (!html.includes(stripped)) return html;

  // 1) Intentar extraer desde el built-in con marcadores HTML
  const markerRe = markerBlockRegex(id);
  const markerMatch = markerRe.exec(builtin);
  if (markerMatch) {
    // markerMatch[2] es el contenido entre START y END; re-inyectamos los
    // markers para que un próximo strip siga funcionando.
    const start = startMarker(id);
    const end = endMarker(id);
    const content = markerMatch[2];
    const reconstructed = `${start}${content}${end}`;
    return html.replace(stripped, reconstructed);
  }

  // 2) Si no, intentar extraer como sección Mustache
  const section = SECTION_BLOCKS[id];
  if (section) {
    const re = mustacheSectionRegex(section.open);
    const m = re.exec(builtin);
    if (m) {
      return html.replace(stripped, m[0]);
    }
  }

  // 3) Para legalFooter (sin sección ni marker): no podemos restaurar —
  // dejamos el marker strippeado. El docente puede tocar el HTML para
  // recuperarlo.
  return html;
}

/**
 * Helper: extrae de un built-in el contenido original de un bloque, útil
 * para previews o tests. Devuelve `null` si el bloque no existe en el
 * built-in.
 */
export function extractBuiltinBlock(builtin: string, id: StudioBlockId): string | null {
  const markerRe = markerBlockRegex(id);
  const markerMatch = markerRe.exec(builtin);
  if (markerMatch && markerMatch[2] !== undefined) return markerMatch[2];

  const section = SECTION_BLOCKS[id];
  if (section) {
    const re = mustacheSectionRegex(section.open);
    const m = re.exec(builtin);
    return m ? m[0] : null;
  }

  return null;
}

// ===========================================================================
// Validación de plantillas: ¿la plantilla tiene todos los marcadores?
// ===========================================================================

/**
 * Para que el Studio funcione completamente, la plantilla built-in debe
 * llevar los marcadores HTML para los bloques no-sección. Esta función
 * devuelve los IDs de bloques que faltan (para warning en la UI).
 */
export function missingBuiltinBlockMarkers(builtin: string): readonly StudioBlockId[] {
  const markerOnly: StudioBlockId[] = ["howToMark", "prohibited", "legalFooter"];
  return markerOnly.filter((id) => !builtin.includes(startMarker(id)));
}

/**
 * Type guard: para que las actions del Studio puedan validar el input
 * `state` que llega del form. Lanza `ValidationError` si llega un ID
 * desconocido.
 */
export function isStudioBlockId(value: string): value is StudioBlockId {
  return (STUDIO_BLOCK_IDS as readonly string[]).includes(value);
}

/** Re-export para tests y otros módulos del Studio. */
export const __testing = {
  STRIPPED_MARKER,
  startMarker,
  endMarker,
  markerBlockRegex,
  mustacheSectionRegex,
};

/** El "key" del template no se usa en estos helpers, pero dejamos la firma
 *  compatible con futuros callers que necesiten cache por variante. */
export type _StudioKey = CoverTemplateKey;
