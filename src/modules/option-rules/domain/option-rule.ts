/**
 * Reglas institucionales de OPCIONES DE RESPUESTA, condicionadas a la tupla
 * (Prueba × Grado × Asignatura).
 *
 * Sprint oct 2026 — el número de opciones por pregunta dejó de ser global
 * (`.env`: EVAL_DEFAULT_OPTIONS / EVAL_MAX_OPTIONS) y pasó a ser una regla
 * del dominio:
 *
 * - **Default estricto**: sin regla, las preguntas tienen EXACTAMENTE 4
 *   opciones.
 * - **Regla de excepción**: por (Prueba × Grado × Asignatura) el admin fija
 *   un mínimo y un máximo configurables, cada uno entre 2 y 8.
 *
 * El GRADO es parte de la clave porque la excepción es para un año y un
 * grado concretos: el grado de la regla debe pertenecer al mismo año
 * académico que la Prueba (se valida en el use case).
 *
 * Por qué 8 es el techo: la hoja de respuestas imprime 8 columnas fijas
 * (A–H) y el OMR escanea 8 columnas por pregunta. Ver
 * `src/modules/printing/domain/answer-sheet-layout.ts`.
 *
 * Reglas de la capa de dominio (no se importa @prisma/client):
 * - Todas las entidades llevan `institutionId` (multi-tenancy).
 * - Las FK se validan en el use case contra los repositorios (no en BD).
 * - Errores legibles: `ValidationError`, `ConflictError`, `NotFoundError`.
 *
 * Edge cases intencionales:
 * - `periodId = null` en la evaluación → no hay match → aplica el default.
 * - El BANCO de preguntas no pertenece a una Prueba ni a un grado (es
 *   institucional por asignatura): su rango es la UNIÓN de las reglas de esa
 *   asignatura entre todos los grados y pruebas (la más permisiva). Al
 *   importar una pregunta del banco a una evaluación se valida contra el
 *   rango de ESA evaluación (que sí es por grado).
 */

/** Mínimo absoluto: verdadero/falso y tricotomías. */
export const OPTION_RULE_MIN = 2;
/** Máximo absoluto: las 8 columnas fijas (A–H) de la hoja de respuestas. */
export const OPTION_RULE_MAX = 8;
/** Default estricto: exactamente 4 opciones cuando no hay regla. */
export const DEFAULT_OPTIONS_COUNT = 4;

/** Rango de opciones permitidas para una pregunta. */
export interface OptionsRange {
  min: number;
  max: number;
}

export interface OptionRule {
  id: string;
  institutionId: string;
  periodId: string;
  /** Grado (Course) al que aplica la excepción. */
  courseId: string;
  subjectId: string;
  minOptions: number;
  maxOptions: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOptionRuleData {
  periodId: string;
  courseId: string;
  subjectId: string;
  minOptions: number;
  maxOptions: number;
  createdById: string;
}

export interface UpdateOptionRuleData {
  minOptions?: number;
  maxOptions?: number;
}

export interface OptionRuleRepository {
  findById(institutionId: string, id: string): Promise<OptionRule | null>;
  listByPeriod(institutionId: string, periodId: string): Promise<OptionRule[]>;
  /** Todas las de la institución (tabla chica: una por combinación
   *  Prueba × Grado × Asignatura). */
  listByInstitution(institutionId: string): Promise<OptionRule[]>;
  /** Todas las reglas de una asignatura, de cualquier grado y prueba. Se usa
   *  para resolver el rango del BANCO (que no pertenece a una prueba ni a un
   *  grado). */
  listBySubject(institutionId: string, subjectId: string): Promise<OptionRule[]>;
  create(institutionId: string, data: CreateOptionRuleData): Promise<OptionRule>;
  update(institutionId: string, id: string, data: UpdateOptionRuleData): Promise<OptionRule | null>;
  delete(institutionId: string, id: string): Promise<void>;
  /**
   * Resuelve `courseSubjectId` → (grado, asignatura) y devuelve la regla de
   * (Prueba × Grado × Asignatura).
   *
   * - `periodId = null` → no hay match → sin regla (aplica el default).
   * - El join a `CourseSubject` filtra por `institutionId`, así que un
   *   `courseSubjectId` de otra institución no matchea nada.
   */
  findForCourseSubject(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
  ): Promise<OptionRule | null>;
}

/**
 * Puerto de RESOLUCIÓN del rango. Lo consumen los use cases que crean o
 * editan preguntas (evaluaciones y banco) para bloquear las que se salen
 * del rango permitido.
 */
export interface OptionRuleResolver {
  /** Rango de una evaluación: el de su (Prueba × Asignatura). */
  forEvaluation(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
  ): Promise<OptionsRange>;
  /** Rango del banco para una asignatura (unión de sus reglas). */
  forSubject(institutionId: string, subjectId: string): Promise<OptionsRange>;
  /** Rangos del banco para varias asignaturas (indexados por subjectId). */
  forSubjects(institutionId: string, subjectIds: string[]): Promise<Record<string, OptionsRange>>;
}

/** Default estricto: exactamente 4 opciones. */
export const DEFAULT_OPTIONS_RANGE: OptionsRange = {
  min: DEFAULT_OPTIONS_COUNT,
  max: DEFAULT_OPTIONS_COUNT,
};

/** ¿El par (min, max) es un rango válido? Enteros, 2..8 y min ≤ max. */
export function isValidOptionsRange(min: number, max: number): boolean {
  return (
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= OPTION_RULE_MIN &&
    max <= OPTION_RULE_MAX &&
    min <= max
  );
}

/** Rango efectivo de una regla (o el default estricto si no hay regla). */
export function resolveOptionsRange(rule: OptionRule | null): OptionsRange {
  if (!rule) return DEFAULT_OPTIONS_RANGE;
  return { min: rule.minOptions, max: rule.maxOptions };
}

/**
 * Con cuántas opciones arranca una pregunta nueva. Intentamos el default
 * (4) y lo ajustamos al rango: si la regla exige 5..8 arrancamos con 5; si
 * la regla topsa en 2..3 arrancamos con el máximo.
 */
export function initialOptionsCount(range: OptionsRange): number {
  return Math.min(Math.max(DEFAULT_OPTIONS_COUNT, range.min), range.max);
}

/** ¿Un conteo de opciones cae dentro del rango? */
export function isOptionsCountAllowed(count: number, range: OptionsRange): boolean {
  return Number.isInteger(count) && count >= range.min && count <= range.max;
}

/** Texto del rango para los mensajes de error ("exactamente 4 opciones"). */
export function describeOptionsRange(range: OptionsRange): string {
  return range.min === range.max
    ? `exactamente ${range.min} opciones`
    : `entre ${range.min} y ${range.max} opciones`;
}

/** Mensaje de error cuando el conteo de opciones no cabe en el rango. */
export function optionsCountErrorMessage(count: number, range: OptionsRange): string {
  return `La pregunta debe tener ${describeOptionsRange(range)} (tiene ${count}).`;
}

/**
 * Resolver por defecto: aplica siempre el default estricto (exactamente 4
 * opciones). Se usa cuando un use case se construye sin resolver —típico en
 * tests— para que la validación siga teniendo el comportamiento de
 * producción. El container de la app inyecta siempre el resolver real de
 * Prisma, que además consulta las reglas configuradas.
 */
export const STRICT_DEFAULT_RESOLVER: OptionRuleResolver = {
  async forEvaluation(): Promise<OptionsRange> {
    return DEFAULT_OPTIONS_RANGE;
  },
  async forSubject(): Promise<OptionsRange> {
    return DEFAULT_OPTIONS_RANGE;
  },
  async forSubjects(
    _institutionId: string,
    subjectIds: string[],
  ): Promise<Record<string, OptionsRange>> {
    const ranges: Record<string, OptionsRange> = {};
    for (const subjectId of subjectIds) ranges[subjectId] = DEFAULT_OPTIONS_RANGE;
    return ranges;
  },
};
