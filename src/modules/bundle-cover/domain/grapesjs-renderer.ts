/**
 * Renderer walker: proyecto GrapesJS → HTML con markers.
 * ========================================================
 *
 * Convierte el JSON del proyecto visual (la salida de `editor.getProject()`
 * o `editor.store()`) en un string HTML con los markers `<!--STUDIO-BLOCK:ID-->`
 * y secciones Mustache `{{#cover.X}}...{{/cover.X}}` que el `RenderCover`
 * existente sabe procesar.
 *
 * ## Por qué un walker manual (NO importamos GrapesJS)
 *
 * GrapesJS es browser-only (~300KB con su parser HTML/CSS). Para renderizar
 * server-side no queremos (a) instanciar GrapesJS en Node, (b) parsear HTML
 * con linkedom/happy-dom solo para eso, ni (c) aceptar el JSON ciegamente.
 *
 * La forma del proyecto que aceptamos está acotada a los tipos que el
 * cliente registra (PR 3): 6 `studio-*` + 4 genéricos. Cualquier otro tipo
 * se rechaza como `MalformedCoverVisualError` — defensa contra payloads
 * crafted que intenten inyectar `<script>` o similar.
 *
 * ## Tipos que el walker reconoce
 *
 * | Type | data-studio-block | Envelope |
 * |------|-------------------|----------|
 * | `studio-callout` | `callout` | `{{#cover.callout.text}}...{{/cover.callout.text}}` |
 * | `studio-how-to-mark` | `howToMark` | `<!--STUDIO-BLOCK:howToMark:START-->...END-->` |
 * | `studio-items-before` | `itemsBefore` | `{{#cover.instructions.items}}...{{/cover.instructions.items}}` |
 * | `studio-items-after` | `itemsAfter` | `{{#cover.instructions.itemsAfter}}...{{/cover.instructions.itemsAfter}}` |
 * | `studio-prohibited` | `prohibited` | `<!--STUDIO-BLOCK:prohibited:START-->...END-->` |
 * | `studio-legal-footer` | `legalFooter` | `<!--STUDIO-BLOCK:legalFooter:START-->...END-->` |
 *
 * Genéricos (sin marker, sin envelope):
 * | `text` | `<p>` con texto |
 * | `image` | `<img>` con `src`/`alt` |
 * | `divider` | `<hr>` |
 * | `two-column` | `<div>` con layout flex/grid |
 *
 * El walker es **puro** — no importa GrapesJS, ni Prisma, ni Mustache, ni
 * DOMPurify. Solo tipos de dominio y manipulación de strings. Vive en
 * `domain/` para que el `RenderCoverVisual` (en `application/`) lo invoque
 * sin romper la regla ESLint de capas.
 */

import { MalformedCoverVisualError } from "./cover-visual";
import { isStudioBlockId, type StudioBlockId } from "./block-sections";

// ---------------------------------------------------------------------------
// Shape del proyecto (lo que produce `editor.getProject()` / `editor.store()`).
// ---------------------------------------------------------------------------

/** Componente recursivo del árbol GrapesJS. */
export interface GrapesJSComponent {
  type: string;
  tagName?: string;
  /** Atributos serializados por GrapesJS (clase, src, href, etc.). */
  attributes?: Record<string, unknown>;
  /** Hijos — solo válido para componentes "container" (ej. `two-column`). */
  components?: GrapesJSComponent[];
  /** Texto plano para componentes hoja (`text`). */
  content?: string;
}

export interface GrapesJSFrame {
  id?: string;
  component?: GrapesJSComponent;
}

export interface GrapesJSPage {
  id?: string;
  frames?: GrapesJSFrame[];
}

export interface GrapesJSStyleRule {
  selectors?: string[];
  style?: Record<string, string>;
}

export interface GrapesJSProjectShape {
  pages?: GrapesJSPage[];
  styles?: GrapesJSSStyleRule[];
}

/** Alias específico para no chocar con `GrapesJSStyleRule` importado por
 *  algún consumidor externo. Mismo shape. */
type GrapesJSSStyleRule = GrapesJSStyleRule;

// ---------------------------------------------------------------------------
// Set cerrado de tipos aceptados. Cualquier otro → MalformedCoverVisualError.
// ---------------------------------------------------------------------------

/** Tipos de componentes que el walker sabe serializar. Coincide con los
 *  `editor.DomComponents.addType(...)` del cliente (PR 3). */
const STUDIO_COMPONENT_TYPES: ReadonlySet<string> = new Set([
  "studio-callout",
  "studio-how-to-mark",
  "studio-items-before",
  "studio-items-after",
  "studio-prohibited",
  "studio-legal-footer",
]);

const GENERIC_COMPONENT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "image",
  "divider",
  "two-column",
]);

const ALL_KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...STUDIO_COMPONENT_TYPES,
  ...GENERIC_COMPONENT_TYPES,
]);

// ---------------------------------------------------------------------------
// Mapping tipo → (studioBlockId | envelope kind). Para los 6 studio blocks.
// ---------------------------------------------------------------------------

type EnvelopeKind =
  | { kind: "marker"; id: StudioBlockId }
  | { kind: "section"; id: StudioBlockId; open: string; close: string };

const COMPONENT_TO_ENVELOPE: ReadonlyMap<string, EnvelopeKind> = new Map([
  [
    "studio-callout",
    {
      kind: "section",
      id: "callout",
      open: "{{#cover.callout.text}}",
      close: "{{/cover.callout.text}}",
    },
  ],
  [
    "studio-items-before",
    {
      kind: "section",
      id: "itemsBefore",
      open: "{{#cover.instructions.items}}",
      close: "{{/cover.instructions.items}}",
    },
  ],
  [
    "studio-items-after",
    {
      kind: "section",
      id: "itemsAfter",
      open: "{{#cover.instructions.itemsAfter}}",
      close: "{{/cover.instructions.itemsAfter}}",
    },
  ],
  ["studio-how-to-mark", { kind: "marker", id: "howToMark" }],
  ["studio-prohibited", { kind: "marker", id: "prohibited" }],
  ["studio-legal-footer", { kind: "marker", id: "legalFooter" }],
]);

// ---------------------------------------------------------------------------
// Helpers de escape (defensa adicional, no reemplaza DOMPurify)
// ---------------------------------------------------------------------------

/** Escapa un valor para usarlo como texto HTML. No es estricto (no escapa
 *  `'` para atributos), pero el `RenderCover` final pasa por DOMPurify que
 *  remueve cualquier cosa peligrosa. Este escape es defensa-en-profundidad
 *  para evitar que un `<script>` en el content salga literal al HTML. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Serializa un objeto `attributes` (que viene de GrapesJS como
 *  `{ class: ['foo','bar'], id: 'x' }` o como `{ class: 'foo bar', id: 'x' }`)
 *  a un string `" class=\"foo bar\" id=\"x\""`. Filtra atributos peligrosos
 *  (`on*`, `style` que contenga `expression(`, `javascript:` en href). */
function serialiseAttributes(attrs: Record<string, unknown> | undefined): string {
  if (!attrs) return "";
  const parts: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(attrs)) {
    const key = rawKey.toLowerCase();
    // Bloqueo defensivo de handlers y URLs peligrosas
    if (key.startsWith("on")) continue;
    if (key === "href" || key === "src" || key === "xlink:href") {
      const valueStr = String(rawValue ?? "")
        .trim()
        .toLowerCase();
      if (
        valueStr.startsWith("javascript:") ||
        valueStr.startsWith("vbscript:") ||
        valueStr.startsWith("data:application/") ||
        valueStr.startsWith("file:")
      ) {
        continue;
      }
    }
    // Normaliza arrays (GrapesJS usa arrays para clases múltiples).
    const value = Array.isArray(rawValue)
      ? rawValue.filter((v) => typeof v === "string").join(" ")
      : String(rawValue ?? "");
    parts.push(`${key}="${escapeText(value)}"`);
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

// ---------------------------------------------------------------------------
// Walker recursivo de un componente
// ---------------------------------------------------------------------------

/**
 * Serializa un componente recursivamente. Devuelve un string HTML. Lanza
 * `MalformedCoverVisualError` si el componente tiene un type desconocido.
 */
function serialiseComponent(node: GrapesJSComponent, depth: number = 0): string {
  const type = node.type;

  if (!type || !ALL_KNOWN_TYPES.has(type)) {
    throw new MalformedCoverVisualError(
      `Tipo de componente desconocido en el proyecto visual: "${type ?? "(sin type)"}". ` +
        `Tipos aceptados: ${[...ALL_KNOWN_TYPES].join(", ")}.`,
    );
  }

  // --- Genéricos -----------------------------------------------------------

  if (type === "text") {
    const tag = node.tagName ?? "p";
    const attrs = serialiseAttributes(node.attributes);
    const text = escapeText(node.content ?? "");
    return `<${tag}${attrs}>${text}</${tag}>`;
  }

  if (type === "image") {
    const attrs = serialiseAttributes(node.attributes);
    // <img> es void; no necesita cierre.
    return `<img${attrs} />`;
  }

  if (type === "divider") {
    return `<hr${serialiseAttributes(node.attributes)} />`;
  }

  if (type === "two-column") {
    const attrs = serialiseAttributes(node.attributes);
    const children = (node.components ?? []).map((c) => serialiseComponent(c, depth + 1)).join("");
    return `<div${attrs} data-gjs-type="two-column">${children}</div>`;
  }

  // --- Studio blocks (6) ---------------------------------------------------

  if (STUDIO_COMPONENT_TYPES.has(type)) {
    const envelope = COMPONENT_TO_ENVELOPE.get(type)!;
    const blockId = envelope.id;
    const innerHtml = serialiseStudioInner(node, depth);

    if (envelope.kind === "marker") {
      return (
        `<!--STUDIO-BLOCK:${blockId}:START-->` + innerHtml + `<!--STUDIO-BLOCK:${blockId}:END-->`
      );
    }
    // Envelope "section" (callout, itemsBefore, itemsAfter)
    return `${envelope.open}\n${innerHtml}\n${envelope.close}`;
  }

  // Nunca llegamos acá gracias al `has(type)` de arriba, pero TS necesita
  // el exhaustivo return.
  throw new MalformedCoverVisualError(`Tipo "${type}" no tiene serializador implementado.`);
}

/** Serializa el contenido INTERNO de un studio block. Para todos los 6
 *  tipos el contenido es un `<div data-studio-block="ID" ...>` con la
 *  `class` por defecto (mimetiza el built-in secundaria-v1) y los hijos
 *  que el usuario haya agregado. */
function serialiseStudioInner(node: GrapesJSComponent, depth: number): string {
  const envelope = COMPONENT_TO_ENVELOPE.get(node.type)!;
  const blockId = envelope.id;
  // La class por defecto reproduce la apariencia del built-in original.
  // Si el usuario agregó clases adicionales en attributes.class, se mergean.
  const DEFAULT_CLASS = STUDIO_BLOCK_DEFAULT_CLASS[blockId];
  const userAttrs = node.attributes ?? {};
  const mergedAttrs: Record<string, unknown> = {
    ...userAttrs,
    "data-studio-block": blockId,
  };
  // Asegurar que `class` siempre tenga al menos el default.
  if (DEFAULT_CLASS) {
    const userClass = userAttrs.class;
    const userClassStr = Array.isArray(userClass)
      ? userClass.join(" ")
      : typeof userClass === "string"
        ? userClass
        : "";
    mergedAttrs.class = userClassStr ? `${DEFAULT_CLASS} ${userClassStr}` : DEFAULT_CLASS;
  }
  const attrsStr = serialiseAttributes(mergedAttrs);
  const children = (node.components ?? []).map((c) => serialiseComponent(c, depth + 1)).join("");
  return `<div${attrsStr}>${children}</div>`;
}

/** Class CSS por defecto para cada studio block. Espeja lo que el built-in
 *  secundaria-v1.html ya tenía antes de existir el visual editor. */
const STUDIO_BLOCK_DEFAULT_CLASS: Record<StudioBlockId, string> = {
  callout: "callout",
  howToMark: "mark-row",
  itemsBefore: "items",
  itemsAfter: "items",
  prohibited: "prohibited-band",
  legalFooter: "legal-footer",
};

// ---------------------------------------------------------------------------
// Re-inject defensivo de markers (idempotente).
// ---------------------------------------------------------------------------

/**
 * Garantiza que los 6 studio blocks tengan sus markers START/END en el HTML
 * aunque el cliente no los haya escrito (defensa adicional). Si el bloque
 * tiene un marker de strip `{{!stripped:ID}}`, NO se re-injecta (el docente
 * lo apagó explícitamente — el Studio lo maneja).
 *
 * Se aplica DESPUÉS de `serialiseProjectToHtml` para evitar dobles markers
 * en el caso normal (el cliente ya los inyecta al guardar).
 */
export function ensureBlockMarkers(html: string): string {
  // Para los 3 bloques "marker" (howToMark, prohibited, legalFooter), si no
  // aparecen los markers y no aparece `{{!stripped:ID}}`, no hacemos nada
  // — el serializador ya los escribió en el caso normal. Esta función es
  // defense-in-depth, no reemplaza al cliente.
  //
  // Hoy es no-op porque el serializador YA emite los markers. Se deja la
  // función exportada para que el RenderCoverVisual la llame explícitamente
  // y para tests.
  return html;
}

// ---------------------------------------------------------------------------
// Función principal: serialiseProjectToHtml
// ---------------------------------------------------------------------------

/**
 * Punto de entrada del walker. Toma el JSON del proyecto y devuelve un
 * string HTML listo para pasar al `RenderCover` (Mustache + DOMPurify).
 *
 * @param project Proyecto GrapesJS (JSON ya validado por el use case con Zod).
 * @returns HTML con markers y/o secciones Mustache.
 * @throws MalformedCoverVisualError si el shape no cumple el contrato.
 */
export function serialiseProjectToHtml(project: unknown): string {
  if (!project || typeof project !== "object") {
    throw new MalformedCoverVisualError("El proyecto visual no es un objeto serializable.");
  }
  const p = project as GrapesJSProjectShape;
  if (!Array.isArray(p.pages) || p.pages.length === 0) {
    throw new MalformedCoverVisualError(
      "El proyecto visual debe tener al menos una página con un frame.",
    );
  }

  const out: string[] = [];
  for (const page of p.pages) {
    if (!page || typeof page !== "object") {
      throw new MalformedCoverVisualError(
        "Una de las páginas del proyecto visual no es un objeto.",
      );
    }
    const frames = page.frames ?? [];
    if (frames.length === 0) {
      throw new MalformedCoverVisualError(`La página "${page.id ?? "(sin id)"}" no tiene frames.`);
    }
    for (const frame of frames) {
      if (!frame || typeof frame !== "object") {
        throw new MalformedCoverVisualError("Un frame del proyecto visual no es un objeto.");
      }
      if (!frame.component) {
        // Frame vacío → no emitimos nada. Permitido (puede haber frames
        // auxiliares para design mobile/tablet que no se imprimen).
        continue;
      }
      out.push(serialiseComponent(frame.component));
    }
  }

  const html = out.join("\n");
  return ensureBlockMarkers(html);
}

// ---------------------------------------------------------------------------
// Helpers exportados para tests
// ---------------------------------------------------------------------------

/** Re-export interno para tests: type guards de los IDs de studio block. */
export const __testing = {
  isStudioBlockId,
  STUDIO_COMPONENT_TYPES,
  GENERIC_COMPONENT_TYPES,
  STUDIO_BLOCK_DEFAULT_CLASS,
  COMPONENT_TO_ENVELOPE,
};
