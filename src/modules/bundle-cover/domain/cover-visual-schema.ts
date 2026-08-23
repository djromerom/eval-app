/**
 * Zod schema del proyecto visual (GrapesJS) persistido en
 * `EvaluationBundle.coverVisualProject`.
 * ============================================================
 *
 * Este schema valida el SHAPE del JSON antes de persistir. No es la
 * misma validación que hace `serialiseProjectToHtml` en el walker
 * (server-side) — ese rechaza `type` desconocido al serializar. Este
 * schema complementa la validación del walker con checks más finos:
 *
 *   • `pages` debe ser array no vacío.
 *   • Cada frame debe tener `id` string.
 *   • Cada componente debe tener `type` y al menos uno de `components` /
 *     `content` / `attributes`.
 *   • `attributes` solo puede tener valores string o array-de-string.
 *
 * El walker es la última línea de defensa (lanza MalformedCoverVisualError
 * si pasa algo que el walker no sabe serializar). El schema es la primera
 * — feedback inmediato al usuario con detalles útiles del campo malo.
 *
 * Mantenemos este schema en `domain/` (no en `application/` ni en la ruta
 * `/cover-visual/`) porque el dominio define el contrato de persistencia
 * del proyecto. La presentación y el server action lo importan.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Atómicos
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1).max(200);

const attributesSchema = z.record(z.union([z.string(), z.array(z.string())])).optional();

// Tipos cerrados de componentes (espejo de `domain/grapesjs-renderer.ts`).
// Si el cliente añade un nuevo type, debe actualizar AMBAS listas.
const STUDIO_TYPES = [
  "studio-callout",
  "studio-how-to-mark",
  "studio-items-before",
  "studio-items-after",
  "studio-prohibited",
  "studio-legal-footer",
] as const;

const GENERIC_TYPES = ["text", "image", "divider", "two-column"] as const;

const componentTypeSchema = z.enum([...STUDIO_TYPES, ...GENERIC_TYPES] as const);

// ---------------------------------------------------------------------------
// Componente recursivo (GrapesJS Component)
// ---------------------------------------------------------------------------

type ComponentSchemaType = z.ZodType<{
  type: (typeof STUDIO_TYPES)[number] | (typeof GENERIC_TYPES)[number];
  tagName?: string;
  attributes?: Record<string, string | string[]>;
  components?: ComponentSchemaType["_output"][];
  content?: string;
}>;

const componentSchema: ComponentSchemaType = z.lazy(() =>
  z.object({
    type: componentTypeSchema,
    tagName: z.string().max(50).optional(),
    attributes: attributesSchema,
    components: z.array(componentSchema).optional(),
    content: z.string().max(10_000).optional(),
  }),
);

// ---------------------------------------------------------------------------
// Frame + Page
// ---------------------------------------------------------------------------

const frameSchema = z.object({
  id: idSchema,
  component: componentSchema.optional(),
});

const pageSchema = z.object({
  id: idSchema,
  frames: z.array(frameSchema).default([]),
});

// ---------------------------------------------------------------------------
// Style rules (opcional)
// ---------------------------------------------------------------------------

const styleRuleSchema = z.object({
  selectors: z.array(z.string().min(1).max(500)).min(1).max(50),
  style: z.record(z.string().max(500)).optional(),
});

// ---------------------------------------------------------------------------
// Project (raíz)
// ---------------------------------------------------------------------------

export const coverVisualProjectSchema = z.object({
  pages: z.array(pageSchema).min(1).max(20),
  styles: z.array(styleRuleSchema).max(500).optional(),
});

/** Inferencia de tipos para usar en la capa de presentación. */
export type CoverVisualProjectParsed = z.infer<typeof coverVisualProjectSchema>;
