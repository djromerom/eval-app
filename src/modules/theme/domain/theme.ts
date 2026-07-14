/**
 * Tema visual para la impresión de cuadernillos.
 *
 * El "tema" NO es un editor libre de layout — el orden de secciones, la
 * geometría de página y la tipografía base están fijados por §3.4 de
 * REQUERIMIENTOS_v2.md. El tema controla UNA capa de personalización
 * institucional/respetada por el colegio:
 *
 * - Colores (acento + tabla de competencias) y de fondo de respuestas.
 * - Familia tipográfica del cuerpo (Serif/Sans).
 * - Densidad tipográfica (compacta/normal/espaciada).
 * - Texto de pie de página (institucional, contacto, resolución).
 * - Mostrar u ocultar el logo del colegio en portada.
 *
 * Además, por evaluación, pueden sobreescribirse:
 * - Subtítulo de portada (período, fecha, docente).
 * - Bloque intro TipTap antes de las preguntas (ej. "Lee el siguiente texto").
 * - Estilo del separador entre secciones (línea / doble línea / puntos).
 *
 * Almacenamiento: las instituciones guardan el tema base en `Institution.theme`
 * (JSONB). Las evaluaciones guardan un override en `Evaluation.theme` (JSONB).
 * En runtime, `mergeTheme()` colapsa los dos en un objeto aplanado con
 * defaults sensatos. Si nada está configurado, se usa el preset
 * `INSTITUCIONAL_DEFAULT` que coincide con el PDF de referencia institucional.
 *
 * Validación: cada JSON que llega de la BD se parsea con el zod schema
 * correspondiente. Lo que no coincida se descarta y cae al default — esto
 * evita que un JSON corrupto rompa la impresión.
 */
import { z } from "zod";

// ===== Tipos literales =====

export const FONT_FAMILIES = ["serif", "sans"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];
export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  serif: "Serif (clásico — Liberation Serif)",
  sans: "Sans (moderno — Liberation Sans)",
};

export const DENSITIES = ["compact", "normal", "airy"] as const;
export type Density = (typeof DENSITIES)[number];
export const DENSITY_LINE_HEIGHTS: Record<Density, number> = {
  compact: 1.05,
  normal: 1.2,
  airy: 1.4,
};
export const DENSITY_LABELS: Record<Density, string> = {
  compact: "Compacta",
  normal: "Normal",
  airy: "Espaciada",
};

export const SECTION_DIVIDERS = ["line", "double", "dots"] as const;
export type SectionDivider = (typeof SECTION_DIVIDERS)[number];
export const SECTION_DIVIDER_LABELS: Record<SectionDivider, string> = {
  line: "Línea simple",
  double: "Doble línea",
  dots: "Línea de puntos",
};

/** Hex color en formato #RRGGBB (sin alpha, sin shorthand). */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// ===== Schemas =====

export const InstitutionalThemeSchema = z.object({
  primary: z.string().regex(HEX_COLOR, "Color primario debe ser #RRGGBB").optional(),
  fontFamily: z.enum(FONT_FAMILIES).default("serif"),
  density: z.enum(DENSITIES).default("normal"),
  footerText: z.string().max(200).optional(),
  showLogo: z.boolean().default(true),
});
export type InstitutionalTheme = z.infer<typeof InstitutionalThemeSchema>;

export const EvaluationThemeSchema = InstitutionalThemeSchema.extend({
  coverSubtitle: z.string().max(200).optional(),
  sectionDivider: z.enum(SECTION_DIVIDERS).default("line"),
  // TipTap JSON: la escuela lo edita con el editor rico. Sin validación
  // estricta aquí (TipTap valida en el cliente). Solo verificamos que sea
  // un objeto no nulo.
  introText: z.record(z.unknown()).nullable().optional(),
});
export type EvaluationTheme = z.infer<typeof EvaluationThemeSchema>;

/** Tema ya colapsado (todos los campos tienen valor). Listo para usar. */
export interface ResolvedTheme {
  primary: string;
  fontFamily: FontFamily;
  density: Density;
  footerText: string;
  showLogo: boolean;
  coverSubtitle: string;
  sectionDivider: SectionDivider;
  introText: Record<string, unknown> | null;
}

// ===== Defaults =====

/**
 * Default institucional — coincide lo más posible con el PDF de referencia
 * `Prueba__11º_I_periodo_C3__1_.pdf` (Liberation Serif, verde institucional
 * neutro, sin subtítulo ni intro porque el PDF no las trae).
 */
export const INSTITUTIONAL_DEFAULT: InstitutionalTheme = {
  primary: "#0B5C2E",
  fontFamily: "serif",
  density: "normal",
  footerText: "",
  showLogo: true,
};

/**
 * Presets de 1-click para el botón "Cambiar look" en la UI admin/teacher.
 * Cada preset es un InstitutionalTheme listo para guardar en Institution.theme.
 */
export const THEME_PRESETS: Record<
  string,
  { label: string; description: string; theme: InstitutionalTheme }
> = {
  clasico: {
    label: "ICFES Clásico",
    description: "Igual al PDF de referencia: serif, verde institucional, densidad normal.",
    theme: {
      primary: "#0B5C2E",
      fontFamily: "serif",
      density: "normal",
      footerText: "",
      showLogo: true,
    },
  },
  moderno: {
    label: "Moderno",
    description:
      "Sans serif, azul oscuro, espaciado generoso, ideal para evaluaciones digitales impresas.",
    theme: {
      primary: "#1E3A8A",
      fontFamily: "sans",
      density: "airy",
      footerText: "",
      showLogo: true,
    },
  },
  compacto: {
    label: "Compacto",
    description:
      "Densidad alta para evaluaciones con muchas preguntas (recorta hasta ~20% del papel).",
    theme: {
      primary: "#0B5C2E",
      fontFamily: "serif",
      density: "compact",
      footerText: "",
      showLogo: true,
    },
  },
};

// ===== Merge =====

/**
 * Colapsa el tema institucional + override de evaluación en un objeto resuelto.
 *
 * Precedencia (de mayor a menor):
 *   1. `evaluationTheme.campo` si está definido
 *   2. `institutionalTheme.campo` si está definido
 *   3. `INSTITUTIONAL_DEFAULT.campo`
 *
 * Arrays/objetos (introText) NO se mergean profundo: si la evaluación trae uno,
 * gana; si no, queda null.
 *
 * Acepta valores `null | undefined` o parcial-inválidos: usar `parseTheme()`
 * primero si vienen de la BD como JSON crudo.
 */
export function mergeTheme(
  institutionalTheme: Partial<InstitutionalTheme> | null | undefined,
  evaluationTheme: Partial<EvaluationTheme> | null | undefined,
): ResolvedTheme {
  const ins = institutionalTheme ?? {};
  const ev = evaluationTheme ?? {};
  const base = INSTITUTIONAL_DEFAULT;

  return {
    primary: ev.primary ?? ins.primary ?? base.primary!,
    fontFamily: ev.fontFamily ?? ins.fontFamily ?? base.fontFamily!,
    density: ev.density ?? ins.density ?? base.density!,
    footerText: ev.footerText ?? ins.footerText ?? base.footerText!,
    showLogo: ev.showLogo ?? ins.showLogo ?? base.showLogo!,
    coverSubtitle: ev.coverSubtitle ?? "",
    sectionDivider: ev.sectionDivider ?? "line",
    introText: ev.introText ?? null,
  };
}

/**
 * Parsea seguro un JSON que llega de Prisma. Valida campo por campo con
 * `safeParse` para NO descartar todo el objeto si UN solo campo está mal.
 *
 * Estrategia: extraer `raw` como objeto genérico, validar cada campo contra
 * su mini-schema, descartar los inválidos. Lo que sobrevive es un objeto
 * `Partial<>` que `mergeTheme()` rellenará con defaults.
 *
 * Esto es importante para el flujo admin: si el usuario escribe "#0B5C2"
 * (hex de 5 dígitos) no queremos que toda la configuración se resetee —
 * solo ese campo cae al default.
 */
type RawTheme = Record<string, unknown>;

const HEX_COLOR_SCHEMA = z.string().regex(HEX_COLOR);
const FONT_SCHEMA = z.enum(FONT_FAMILIES);
const DENSITY_SCHEMA = z.enum(DENSITIES);
const BOOL_SCHEMA = z.boolean();
const DIVIDER_SCHEMA = z.enum(SECTION_DIVIDERS);

function pickString(o: RawTheme, key: string, max?: number): string | undefined {
  const v = o[key];
  if (typeof v !== "string") return undefined;
  const r = max ? z.string().max(max).safeParse(v) : z.string().safeParse(v);
  return r.success ? r.data : undefined;
}

function pickAndValidate<T>(o: RawTheme, key: string, schema: z.ZodType<T>): T | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  const r = schema.safeParse(v);
  return r.success ? r.data : undefined;
}

export function parseInstitutionalTheme(raw: unknown): Partial<InstitutionalTheme> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as RawTheme;
  const out: Partial<InstitutionalTheme> = {};
  const primary = pickAndValidate(o, "primary", HEX_COLOR_SCHEMA);
  if (primary !== undefined) out.primary = primary;
  const ff = pickAndValidate(o, "fontFamily", FONT_SCHEMA);
  if (ff !== undefined) out.fontFamily = ff;
  const d = pickAndValidate(o, "density", DENSITY_SCHEMA);
  if (d !== undefined) out.density = d;
  const ft = pickString(o, "footerText", 200);
  if (ft !== undefined) out.footerText = ft;
  const sl = pickAndValidate(o, "showLogo", BOOL_SCHEMA);
  if (sl !== undefined) out.showLogo = sl;
  return out;
}

export function parseEvaluationTheme(raw: unknown): Partial<EvaluationTheme> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as RawTheme;
  // Base + extras de evaluación.
  const base = parseInstitutionalTheme(raw);
  const out: Partial<EvaluationTheme> = { ...base };
  const cs = pickString(o, "coverSubtitle", 200);
  if (cs !== undefined) out.coverSubtitle = cs;
  const sd = pickAndValidate(o, "sectionDivider", DIVIDER_SCHEMA);
  if (sd !== undefined) out.sectionDivider = sd;
  // TipTap JSON: acepta cualquier objeto no nulo. Validación más profunda
  // se hace en el cliente al renderizar el editor.
  if (o.introText && typeof o.introText === "object") {
    out.introText = o.introText as Record<string, unknown>;
  }
  return out;
}

// ===== CSS bridge =====

/**
 * Convierte un ResolvedTheme en variables CSS listas para inyectar en un
 * `<style>` o `style={{ '--primary': theme.primary }}`. Los nombres siguen
 * la convención de custom properties `--print-*` para no chocar con el
 * tema del dashboard.
 *
 * El código del print page emite esto en el `<head>` y los estilos en
 * `print.css` los consumen con `var(--print-primary)` etc.
 */
export function themeToCssVars(theme: ResolvedTheme): Record<string, string> {
  return {
    "--print-primary": theme.primary,
    "--print-font-family":
      theme.fontFamily === "serif"
        ? "'Liberation Serif', 'Times New Roman', Times, serif"
        : "'Liberation Sans', Arial, Helvetica, sans-serif",
    "--print-line-height": String(DENSITY_LINE_HEIGHTS[theme.density]),
    "--print-footer-text": `"${(theme.footerText ?? "").replace(/"/g, '\\"')}"`,
    "--print-show-logo": theme.showLogo ? "block" : "none",
  };
}
