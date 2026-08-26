/**
 * Dominio: plantilla de portada del cuadernillo.
 *
 * Modelo:
 *   • Una plantilla es un HTML con variables Mustache (carpeta
 *     eval-app/templates/cover/). Las plantillas se identifican por una
 *     clave versionada: `<familia>-v<n>` (ej. "secundaria-v1").
 *   • Un bundle puede tener un override: si `coverTemplateBody` está
 *     seteado en BD, gana sobre el built-in de la misma key.
 *   • La combinación resultante (built-in o override) se renderiza contra
 *     un contexto de datos del bundle (ver cover-context.ts) y se sanitiza
 *     antes de inyectarse al PDF / preview.
 *
 * El dominio NO conoce Prisma, ni el sistema de archivos, ni Mustache, ni
 * DOMPurify — solo tipos puros y el contrato de persistencia.
 */

import { DomainError, ValidationError } from "@/shared/domain/result";

/**
 * Identificador de variante. Branding `<familia>-v<n>` para que sea evidente
 *   cuándo hay un cambio incompatible con overrides guardados.
 */
export type CoverTemplateKey = string & { readonly __brand: "CoverTemplateKey" };

/** Familia + versión: se valida con regex antes de castear. */
const KEY_PATTERN = /^[a-z][a-z0-9-]{0,30}-v\d+$/;

/** Lanza ValidationError si la key no cumple el patrón. */
export function toCoverTemplateKey(value: string): CoverTemplateKey {
  if (!KEY_PATTERN.test(value)) {
    throw new ValidationError(
      `Identificador de plantilla inválido: "${value}". Debe ser kebab-case terminado en "-v<n>" (ej. "secundaria-v1").`,
    );
  }
  return value as CoverTemplateKey;
}

/** Variantes que el sistema conoce hoy. Añadir aquí cuando se cree un nuevo
 *  built-in bajo templates/cover/ para que el type-checker lo exija. */
export const KNOWN_COVER_TEMPLATE_KEYS = ["secundaria-v1"] as const;
export type KnownCoverTemplateKey = (typeof KNOWN_COVER_TEMPLATE_KEYS)[number];

/** Fallback del sistema cuando un bundle nunca ha sido tocado por el cover
 *  designer. Hoy coincide con la primera variante conocida. */
export const DEFAULT_COVER_TEMPLATE_KEY: CoverTemplateKey = toCoverTemplateKey("secundaria-v1");

/** Fuente del HTML que se renderiza. */
export type CoverTemplateSource = "BUILT_IN" | "OVERRIDE";

/** Estado actual del cover configurado para un bundle. Es lo que ve el
 *  designer UI: qué key está seleccionada, si tiene override, y cuándo se
 *  editó por última vez. NO contiene el HTML en sí — eso lo carga el loader. */
export interface CoverTemplateState {
  bundleId: string;
  /** Key efectiva que se usa para cargar el built-in (sea override o no). */
  key: CoverTemplateKey;
  /** Source efectivo del render: BUILT_IN si no hay override, OVERRIDE si
   *  coverTemplateBody != null. */
  source: CoverTemplateSource;
  /** true si hay un body overrideado guardado en BD. */
  hasOverride: boolean;
  /** Cuándo se guardó el último override (null si nunca se editó). */
  updatedAt: Date | null;
}

/** Resultado del render: HTML sanitizado, listo para inyectar al PDF / iframe. */
export interface RenderedCover {
  html: string;
  source: CoverTemplateSource;
  /** Key efectiva usada (la del override si hay, si no la del bundle). */
  key: CoverTemplateKey;
}

/** Error de render por contenido inseguro detectado por el sanitizador. Se
 *  separa del ValidationError genérico porque la UI debe mostrarlo de forma
 *  distinta (no es un dato malformado — es un XSS / CSS injection que el
 *  docente intentó guardar). */
export class UnsafeCoverTemplateError extends DomainError {
  constructor(message: string) {
    super("UNSAFE_COVER_TEMPLATE", message);
    this.name = "UnsafeCoverTemplateError";
  }
}

/**
 * Puerto de persistencia: el estado de plantilla asociado a un bundle.
 * Implementado por `PrismaCoverTemplateRepository` (columnas en
 * EvaluationBundle).
 *
 * Cada llamada filtra por `institutionId` para mantener el aislamiento
 * tenant — el dominio pasa el id explícito y la capa de aplicación lo
 * obtiene del actor autenticado (ver REQUERIMIENTOS_v2 §6.3).
 *
 * Los métodos que no encuentran el bundle en la institución indicada
 * lanzan `NotFoundError` (no devuelven null) — el dominio prefiere un
 * throw explícito a un optional que el caller puede olvidar.
 */
export interface CoverTemplateRepository {
  /**
   * Lee el estado actual (sin el HTML en sí). Devuelve un estado con la
   * key por defecto del sistema si el bundle nunca fue configurado.
   */
  loadState(institutionId: string, bundleId: string): Promise<CoverTemplateState>;

  /**
   * Lee el body del override, o `null` si el bundle está cayendo al
   * built-in. La combinación de `loadState` + `loadBody` es lo que usa
   * el render: si `state.source === "OVERRIDE"` y `loadBody` devuelve
   * string, ese es el HTML a usar; si no, se usa el built-in.
   */
  loadBody(institutionId: string, bundleId: string): Promise<string | null>;

  /**
   * Persiste el body como override de la key actual del bundle. La key NO
   * cambia — para cambiar de variante usar `setKey`.
   */
  saveOverride(institutionId: string, bundleId: string, body: string): Promise<CoverTemplateState>;

  /** Borra el override (coverTemplateBody = null). No toca la key. */
  resetOverride(institutionId: string, bundleId: string): Promise<CoverTemplateState>;

  /**
   * Cambia la variante del bundle. Si la key es null, se vuelve a la
   * DEFAULT_COVER_TEMPLATE_KEY. NO toca el override existente: si el bundle
   * ya tenía body, queda apuntando a la nueva key (útil para "clonar" un
   * override a otra variante, o confuso — el caller decide si resetear
   * primero).
   */
  setKey(
    institutionId: string,
    bundleId: string,
    key: CoverTemplateKey | null,
  ): Promise<CoverTemplateState>;
}

/** Tamaño máximo del body de override (en bytes). Defiende contra subidas
 *  accidentales de archivos grandes y contra DOS por strings gigantes.
 *  ~200KB es holgado para una portada con CSS embebido. */
export const MAX_COVER_TEMPLATE_BODY_BYTES = 200_000;

/** Tamaño mínimo razonable: una portada debe tener al menos HTML+CSS básico. */
export const MIN_COVER_TEMPLATE_BODY_BYTES = 200;

/**
 * Puerto: carga el HTML de una plantilla built-in desde el sistema de
 * archivos. La capa de aplicación usa este loader solo cuando
 * `state.source === "BUILT_IN"`. Cuando hay override, el body viene del
 * repositorio, no del FS.
 *
 * Vive en `domain/` (no en `infrastructure/`) porque la application layer
 * depende del contrato, no de la implementación. Es análogo a
 * `CoverTemplateRepository`.
 */
export interface CoverTemplateLoader {
  loadBuiltIn(key: CoverTemplateKey): Promise<string>;
  /** Lista las claves que tienen un built-in disponible. Útil para
   *  mostrar el dropdown del designer. */
  listAvailableKeys(): Promise<CoverTemplateKey[]>;
}
