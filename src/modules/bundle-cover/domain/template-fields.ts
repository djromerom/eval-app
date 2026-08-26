/**
 * Parser de variables Mustache del template de portada → campos del schema
 * `CoverContent`.
 * ==============================================================
 *
 * El form de "Contenido de portada" en el cover-designer debe mostrar SOLO
 * los inputs que la plantilla actual realmente usa. Si la plantilla no usa
 * `{{cover.callout.text}}`, no tiene sentido mostrarle al docente un
 * textarea para `calloutText` (lo que escriba no se va a renderizar).
 *
 * Cómo funciona:
 *   1. `extractCoverContentFields(body)` parsea el HTML del template (sea
 *      built-in o override) y devuelve dos listas:
 *        - `strings`: campos del schema referenciados como `{{X}}` (texto
 *          simple que Mustache inyecta en el render).
 *        - `arrays`:  campos del schema referenciados como sección
 *          `{{#X}}…{{/X}}` (arrays que Mustache itera).
 *   2. `FIELD_META` da metadata de display (label, hint, maxLength,
 *      multiline) para cada campo del schema — es la fuente de verdad
 *      que consume la UI para saber cómo pintar cada input.
 *   3. `BLOCK_META` agrupa los campos en bloques visuales (instrucciones,
 *      ¿cómo marcar?, prohibido, pie legal) para que la UI los pueda
 *      renderizar agrupados, igual que en PR 4 pero solo con los campos
 *      que la plantilla usa.
 *
 * Por qué un mapa estático Mustache → schema (vs. reverse-engineering):
 *   El schema usa camelCase plano (`calloutText`), pero los templates
 *   usan dotted notation (`cover.callout.text`). El dotted es coherente
 *   con el shape que arma `BuildCoverContext` (cover.callout.text →
 *   coverContent.calloutText). El mapa Mustache_TO_SCHEMA captura esa
 *   traducción en un solo lugar — si cambia el shape del contexto,
 *   actualizamos este mapa y el form se adapta.
 *
 * Tests: `tests/unit/template-fields.test.ts`.
 */
import { type CoverContent } from "./cover-content";

/** Todos los campos posibles del schema `CoverContent`. */
export type CoverContentField = keyof CoverContent;

/** Mapa de rutas Mustache (dotted) a campos planos del schema. */
const MUSTACHE_TO_SCHEMA: Record<string, CoverContentField> = {
  // legalFooter se inyecta en `institution.legalFooter` (no `cover.legalFooter`)
  // — coherente con el shape que arma BuildCoverContext.
  "institution.legalFooter": "legalFooter",
  "cover.instructions.title": "instructionsTitle",
  "cover.instructions.items": "itemsBefore",
  "cover.instructions.itemsAfter": "itemsAfter",
  "cover.callout.text": "calloutText",
  "cover.howToMark.question": "howToMarkQuestion",
  "cover.howToMark.example": "howToMarkExample",
  "cover.howToMark.exampleLabel": "howToMarkExampleLabel",
  "cover.prohibited.title": "prohibitedTitle",
  "cover.prohibited.body": "prohibitedBody",
};

/** Campos del schema que son arrays (se renderizan como bullets). */
const ARRAY_SCHEMA_FIELDS = new Set<CoverContentField>(["itemsBefore", "itemsAfter"]);

/** Bloques visuales en los que se agrupan los campos en el form. */
export type CoverContentBlock = "instructions" | "howToMark" | "prohibited" | "legal";

const BLOCK_META: Record<CoverContentField, CoverContentBlock> = {
  instructionsTitle: "instructions",
  itemsBefore: "instructions",
  calloutText: "instructions",
  howToMarkQuestion: "howToMark",
  howToMarkExampleLabel: "howToMark",
  howToMarkExample: "howToMark",
  itemsAfter: "howToMark",
  prohibitedTitle: "prohibited",
  prohibitedBody: "prohibited",
  legalFooter: "legal",
};

const BLOCK_LABELS: Record<CoverContentBlock, string> = {
  instructions: "Bloque de instrucciones",
  howToMark: 'Bloque "¿Cómo marcar en su hoja de respuestas?"',
  prohibited: 'Bloque "Prohibido"',
  legal: "Pie legal",
};

/** Orden estable de los bloques (para el render). */
const BLOCK_ORDER: readonly CoverContentBlock[] = [
  "instructions",
  "howToMark",
  "prohibited",
  "legal",
];

/**
 * Metadata de display de cada campo del schema.
 *
 * Si agregas un campo nuevo a `CoverContentSchema`:
 *   1. Añádelo al schema con su maxLength.
 *   2. Añádelo a `MUSTACHE_TO_SCHEMA` con la ruta Mustache correspondiente.
 *   3. Añádelo a `BLOCK_META` (campo → bloque).
 *   4. Añádelo a `FIELD_META` con label/hint/maxLength/multiline.
 *   5. (Si es array) Añádelo a `ARRAY_SCHEMA_FIELDS`.
 *
 * El UI automáticamente generará el input correspondiente.
 */
export interface FieldMeta {
  /** Etiqueta visible en el form. */
  label: string;
  /** Descripción opcional debajo del input. */
  hint?: string;
  /** Máximo de caracteres por ítem (del schema). El form trunca al typing. */
  maxLength: number;
  /**
   * Máximo de ÍTEMS para campos array. Si está presente, el form lo usa
   * como límite del editor de bullets. Si no, el campo se renderiza como
   * string.
   */
  arrayMax?: number;
  /**
   * Placeholder del input (opcional). Solo se usa para los bullets — los
   * strings usan como placeholder el valor resuelto (institución / DEFAULT).
   */
  placeholder?: string;
  /**
   * Si true, se renderiza como `<textarea>`; si no, como `<Input>`.
   * Útil para textos largos con saltos de línea (callout, howToMarkQuestion,
   * prohibitedBody).
   */
  multiline?: boolean;
}

export const FIELD_META: Record<CoverContentField, FieldMeta> = {
  legalFooter: {
    label: "Pie de página",
    hint: "Resolución rectoral, código DANE, etc. Aparece al pie de la portada.",
    maxLength: 300,
  },
  instructionsTitle: {
    label: "Título del bloque",
    hint: "Si lo dejas en blanco se usa el título por defecto.",
    maxLength: 80,
  },
  itemsBefore: {
    label: "Indicaciones iniciales",
    hint: "Aparecen ANTES del callout destacado.",
    maxLength: 200,
    arrayMax: 10,
    placeholder: "Ej. Lea cada pregunta antes de responder.",
  },
  itemsAfter: {
    label: "Indicaciones finales",
    hint: "Aparecen DESPUÉS del bloque ¿cómo marcar? (verificación, firma, entrega del material).",
    maxLength: 200,
    arrayMax: 15,
    placeholder: "Ej. Verifique sus respuestas antes de entregar la hoja.",
  },
  calloutText: {
    label: "Callout destacado",
    hint: "Caja con borde redondeado entre los bullets iniciales y el bloque ¿cómo marcar?.",
    maxLength: 400,
    multiline: true,
  },
  howToMarkQuestion: {
    label: "Pregunta + ejemplo",
    hint: "Puede llevar saltos de línea.",
    maxLength: 400,
    multiline: true,
  },
  howToMarkExample: {
    label: 'Texto del ejemplo ("Por ejemplo, si la opción correcta es B…")',
    maxLength: 200,
  },
  howToMarkExampleLabel: {
    label: 'Etiqueta del rectángulo de ejemplo ("MARQUE ASÍ")',
    hint: "Texto corto en la parte superior del rectángulo con burbujas.",
    maxLength: 80,
  },
  prohibitedTitle: {
    label: "Título",
    maxLength: 80,
  },
  prohibitedBody: {
    label: "Cuerpo",
    hint: "Justificación legal de los elementos prohibidos (dispositivos electrónicos, consultas, etc.).",
    maxLength: 800,
    multiline: true,
  },
};

/** Resultado de `extractCoverContentFields`. */
export interface ExtractedFields {
  /** Campos string (referenciados como `{{X}}` en el template). */
  strings: readonly CoverContentField[];
  /** Campos array (referenciados como sección `{{#X}}…{{/X}}`). */
  arrays: readonly CoverContentField[];
  /**
   * `true` si el template referencia alguna variable de `cover.*` o
   * `institution.legalFooter`. Si es `false`, la UI puede mostrar un
   * mensaje "esta plantilla no usa contenido de portada editable".
   */
  hasAny: boolean;
}

/**
 * Regex para tags Mustache. Captura:
 *   - grupo 1: sigilo opcional (`#` sección, `/` cierre, `^` invertido, vacío = valor)
 *   - grupo 2: la ruta dotted (palabras y puntos)
 *
 * No captura comentarios (`{{! … }}`), ya que no son variables usables.
 * Tags raw `{{{X}}}` también matchean porque el `!` después de `{{`
 * no interfiere con la captura del sigilo.
 */
const TAG_PATTERN = /\{\{!?\s*([#/^]?)\s*([\w.]+)\s*\}\}/g;

/**
 * Extrae del HTML del template los campos del schema `CoverContent` que
 * efectivamente se referencian.
 *
 * Pura — sin I/O. Llamada desde `cover-designer/page.tsx` antes de
 * pintar el form, pasándole `initial.editorBody` (que ya es el body
 * efectivo: built-in si no hay override, override si existe).
 *
 * Si el body es vacío / no contiene ningún tag Mustache, devuelve listas
 * vacías y `hasAny=false` — la UI debe mostrar un mensaje "vacío" en ese
 * caso (no debería pasar en producción porque toda plantilla debe tener
 * al menos `{{institution.name}}`, pero es defensa).
 */
export function extractCoverContentFields(body: string): ExtractedFields {
  const sections = new Set<string>();
  const values = new Set<string>();

  for (const match of body.matchAll(TAG_PATTERN)) {
    const sigil = match[1] ?? "";
    const path = match[2];
    if (!path) continue;
    if (sigil === "#") {
      sections.add(path);
    } else if (sigil !== "/" && sigil !== "^") {
      values.add(path);
    }
  }

  const strings: CoverContentField[] = [];
  const arrays: CoverContentField[] = [];

  for (const path of sections) {
    const field = MUSTACHE_TO_SCHEMA[path];
    if (field !== undefined && ARRAY_SCHEMA_FIELDS.has(field)) {
      arrays.push(field);
    }
  }
  for (const path of values) {
    const field = MUSTACHE_TO_SCHEMA[path];
    if (field !== undefined && !ARRAY_SCHEMA_FIELDS.has(field)) {
      strings.push(field);
    }
  }

  return {
    strings,
    arrays,
    hasAny: strings.length > 0 || arrays.length > 0,
  };
}

/**
 * Agrupa los campos extraídos por bloque visual, respetando el orden
 * estable de `BLOCK_ORDER` y dentro de cada bloque el orden de aparición
 * en `BLOCK_META`.
 */
export interface FieldsByBlock {
  block: CoverContentBlock;
  label: string;
  fields: readonly CoverContentField[];
}

export function groupFieldsByBlock(fields: ExtractedFields): readonly FieldsByBlock[] {
  const byBlock = new Map<CoverContentBlock, CoverContentField[]>();
  const all = [...fields.strings, ...fields.arrays];
  for (const f of all) {
    const block = BLOCK_META[f];
    if (!byBlock.has(block)) byBlock.set(block, []);
    byBlock.get(block)!.push(f);
  }
  return BLOCK_ORDER.filter((b) => byBlock.has(b)).map((b) => {
    const fields = byBlock.get(b);
    if (!fields) return { block: b, label: BLOCK_LABELS[b], fields: [] };
    return { block: b, label: BLOCK_LABELS[b], fields };
  });
}
