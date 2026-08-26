/**
 * Contenido textual overrideable de la portada (cover).
 * =====================================================
 *
 * Esta capa NO controla el layout ni los colores — eso vive en
 * `src/modules/theme/domain/theme.ts`. Aquí vive el COPY institucional y
 * por-compendio: el texto que aparece en el bloque de instrucciones, el
 * callout, el bloque "¿cómo marcar?" y el bloque "Prohibido".
 *
 * Razón de ser: las plantillas `templates/cover/*.html` tienen el copy
 * literal hardcoded en español. Para que cada colegio / cada compendio
 * pueda ajustar la redacción sin tocar el HTML ni redeployar, persistimos
 * las cadenas en JSONB.
 *
 * Almacenamiento (dos columnas nuevas en PR 1):
 *
 *   Institution.coverContent       — overrides institucionales (legal footer,
 *                                    cuerpo del bloque prohibido). Lo configura
 *                                    el admin en /admin/theme.
 *   EvaluationBundle.coverContent  — overrides por compendio (instrucciones,
 *                                    callout, howToMark, etc.). Lo configura
 *                                    el lider/docente en /admin/bundles/:id/
 *                                    cover-designer.
 *
 * En runtime, `getResolvedCoverContent()` (PR 2) colapsa los dos:
 *
 *   bundle.coverContent ?? institution.coverContent ?? DEFAULT_*
 *
 * Si NINGÚN nivel define el campo, cae al `DEFAULT_*` exportado por
 * `./cover-defaults.ts`. Así el PDF sigue saliendo aunque la BD esté vacía.
 *
 * Validación: cada JSON que llega de Prisma se parsea con `parseCoverContent()`,
 * que descarta campo por campo si está mal formado. NO descartamos el objeto
 * entero por un campo malo — eso evita que un caracter inválido resetee toda
 * la portada.
 *
 * Por qué campos opcionales (no `.default()`): los defaults viven en
 * `cover-defaults.ts` como constantes visibles, y queremos que el JSONB
 * guarde SOLO lo que el usuario configuró explícitamente (null = "no
 * configurado, cae al default"). Esto facilita diffs de git y futuras
 * migraciones de schema.
 */
import { z } from "zod";
import {
  DEFAULT_CALLOUT_TEXT,
  DEFAULT_HOW_TO_MARK_EXAMPLE,
  DEFAULT_HOW_TO_MARK_LABEL,
  DEFAULT_HOW_TO_MARK_QUESTION,
  DEFAULT_INSTRUCTIONS_ITEMS_AFTER,
  DEFAULT_INSTRUCTIONS_ITEMS_BEFORE,
  DEFAULT_INSTRUCTIONS_TITLE,
  DEFAULT_LEGAL_FOOTER,
  DEFAULT_PROHIBITED_BODY,
  DEFAULT_PROHIBITED_TITLE,
} from "../application/cover-defaults";

// ===== Schemas =====

/**
 * Schema "fuerte": usado para validación en el server action antes de
 * persistir. Garantiza tipos y longitudes máximas. Todos los campos son
 * opcionales — si no se define uno, en runtime cae al DEFAULT.
 */
export const CoverContentSchema = z.object({
  /** Pie legal al pie de la portada. Si la institución lo deja vacío, cae al
   *  DEFAULT_LEGAL_FOOTER exportado por `./cover-defaults`. */
  legalFooter: z.string().max(300).optional(),

  /** Título del tab "Instrucciones" en la columna derecha. Default: "Instrucciones". */
  instructionsTitle: z.string().max(80).optional(),

  /** Bullets de instrucciones ANTES del callout destacado (los 4 iniciales).
   *  Máximo 10 ítems para no saturar la página. */
  itemsBefore: z.array(z.string().max(200)).max(10).optional(),

  /** Callout destacado (la caja con borde redondeado) entre los bullets
   *  iniciales y el bloque "¿cómo marcar?". Una o dos líneas. */
  calloutText: z.string().max(400).optional(),

  /** Pregunta + ejemplo del bloque "¿CÓMO MARCAR EN SU HOJA DE
   *  RESPUESTAS?". Puede llevar saltos de línea (la plantilla usa `<br>`). */
  howToMarkQuestion: z.string().max(400).optional(),

  /** Texto del ejemplo ("Por ejemplo, si la opción correcta es B").
   *  Aparece después de `howToMarkQuestion` en la plantilla. */
  howToMarkExample: z.string().max(200).optional(),

  /** Etiqueta pequeña del rectángulo de burbujas (la caja con el ejemplo
   *  visual). Default: "MARQUE ASÍ". */
  howToMarkExampleLabel: z.string().max(80).optional(),

  /** Bullets de instrucciones DESPUÉS del bloque cómo-marcar (los 6 finales,
   *  incluyendo la firma y la entrega del material). Máximo 15 ítems. */
  itemsAfter: z.array(z.string().max(200)).max(15).optional(),

  /** Título del bloque "Prohibido" al pie de la portada. Default: "Prohibido". */
  prohibitedTitle: z.string().max(80).optional(),

  /** Cuerpo completo del bloque prohibido (justificación legal). Default:
   *  el texto sobre dispositivos electrónicos del kit ICFES. */
  prohibitedBody: z.string().max(800).optional(),
});
export type CoverContent = z.infer<typeof CoverContentSchema>;

// ===== Parsers defensivos =====

type RawContent = Record<string, unknown>;

const STR_80 = z.string().max(80);
const STR_200 = z.string().max(200);
const STR_300 = z.string().max(300);
const STR_400 = z.string().max(400);
const STR_800 = z.string().max(800);

/** Toma un string de un objeto validándolo con el schema dado. Si el valor
 *  no es string o no pasa el schema, devuelve undefined (no lanza). */
function pickString(o: RawContent, key: string, schema: z.ZodType<string>): string | undefined {
  const v = o[key];
  if (typeof v !== "string") return undefined;
  const r = schema.safeParse(v);
  return r.success ? r.data : undefined;
}

/** Toma un array de strings, descartando los ítems que no son strings o que
 *  pasan el límite de longitud. Limita a `max` ítems totales. Si el resultado
 *  es vacío, devuelve undefined para que `mergeCoverContent` caiga al default. */
function pickStringArray(o: RawContent, key: string, max: number): string[] | undefined {
  const v = o[key];
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const r = STR_200.safeParse(item);
    if (r.success) out.push(r.data);
    if (out.length >= max) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Parsea seguro un JSON que llega de Prisma (`Institution.coverContent` o
 * `EvaluationBundle.coverContent`). Aplica la misma estrategia que
 * `parseEvaluationTheme()` en `theme.ts`: descarta campo por campo si está
 * mal formado, dejando que el resto sobreviva.
 *
 * Si el JSON es null, no es objeto, o tiene todos los campos inválidos,
 * devuelve `{}` y el caller rellena con defaults en runtime.
 */
export function parseCoverContent(raw: unknown): Partial<CoverContent> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as RawContent;
  const out: Partial<CoverContent> = {};

  const lf = pickString(o, "legalFooter", STR_300);
  if (lf !== undefined) out.legalFooter = lf;

  const it = pickString(o, "instructionsTitle", STR_80);
  if (it !== undefined) out.instructionsTitle = it;

  const ib = pickStringArray(o, "itemsBefore", 10);
  if (ib !== undefined) out.itemsBefore = ib;

  const ct = pickString(o, "calloutText", STR_400);
  if (ct !== undefined) out.calloutText = ct;

  const hmq = pickString(o, "howToMarkQuestion", STR_400);
  if (hmq !== undefined) out.howToMarkQuestion = hmq;

  const hme = pickString(o, "howToMarkExample", STR_200);
  if (hme !== undefined) out.howToMarkExample = hme;

  const hmel = pickString(o, "howToMarkExampleLabel", STR_80);
  if (hmel !== undefined) out.howToMarkExampleLabel = hmel;

  const ia = pickStringArray(o, "itemsAfter", 15);
  if (ia !== undefined) out.itemsAfter = ia;

  const pt = pickString(o, "prohibitedTitle", STR_80);
  if (pt !== undefined) out.prohibitedTitle = pt;

  const pb = pickString(o, "prohibitedBody", STR_800);
  if (pb !== undefined) out.prohibitedBody = pb;

  return out;
}

/**
 * ResolvedCoverContent: el shape final después de colapsar
 * bundle.coverContent ?? institution.coverContent ?? defaults.
 *
 * Todos los campos son strings/arrays no-undefined. Es el input que
 * consume `BuildCoverContext` para armar la sección `cover.*` del
 * CoverContext que se le pasa a Mustache.
 */
export interface ResolvedCoverContent {
  legalFooter: string;
  instructionsTitle: string;
  itemsBefore: readonly string[];
  calloutText: string;
  howToMarkQuestion: string;
  howToMarkExample: string;
  howToMarkExampleLabel: string;
  itemsAfter: readonly string[];
  prohibitedTitle: string;
  prohibitedBody: string;
}

/**
 * Colapsa (institutional, bundle) en un objeto resuelto, aplicando la
 * precedencia bundle > institución > DEFAULT_*. Pura — sin I/O.
 *
 * Si AMBOS lados traen un campo, gana el bundle. Si NINGUNO lo trae,
 * cae al DEFAULT exportado por `./cover-defaults.ts`. Es la función
 * inversa de los campos opcionales: el JSONB guarda SOLO overrides
 * (null = "no configurar"), y esta función rellena con defaults.
 *
 * Los strings y arrays NO se mergean profundo: si el bundle trae un
 * array, gana entero (no concatena con el institucional). Es coherente
 * con `mergeTheme()` en `@/modules/theme/domain/theme.ts`.
 */
export function mergeCoverContent(
  institutional: Partial<CoverContent>,
  bundle: Partial<CoverContent>,
): ResolvedCoverContent {
  const ins = institutional ?? {};
  const bud = bundle ?? {};
  return {
    legalFooter: bud.legalFooter ?? ins.legalFooter ?? DEFAULT_LEGAL_FOOTER,
    instructionsTitle: bud.instructionsTitle ?? ins.instructionsTitle ?? DEFAULT_INSTRUCTIONS_TITLE,
    itemsBefore: bud.itemsBefore ?? ins.itemsBefore ?? DEFAULT_INSTRUCTIONS_ITEMS_BEFORE,
    calloutText: bud.calloutText ?? ins.calloutText ?? DEFAULT_CALLOUT_TEXT,
    howToMarkQuestion:
      bud.howToMarkQuestion ?? ins.howToMarkQuestion ?? DEFAULT_HOW_TO_MARK_QUESTION,
    howToMarkExample: bud.howToMarkExample ?? ins.howToMarkExample ?? DEFAULT_HOW_TO_MARK_EXAMPLE,
    howToMarkExampleLabel:
      bud.howToMarkExampleLabel ?? ins.howToMarkExampleLabel ?? DEFAULT_HOW_TO_MARK_LABEL,
    itemsAfter: bud.itemsAfter ?? ins.itemsAfter ?? DEFAULT_INSTRUCTIONS_ITEMS_AFTER,
    prohibitedTitle: bud.prohibitedTitle ?? ins.prohibitedTitle ?? DEFAULT_PROHIBITED_TITLE,
    prohibitedBody: bud.prohibitedBody ?? ins.prohibitedBody ?? DEFAULT_PROHIBITED_BODY,
  };
}
