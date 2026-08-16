import { richTextHasRenderableContent } from "@/shared/domain/rich-text";
import type { EvaluationStatus } from "./evaluation-status";

export type AnswerKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type SoloLevel =
  "UNI_ESTRUCTURAL" | "MULTIESTRUCTURAL" | "RELACIONAL" | "ABSTRACTO_EXTENDIDO";

export interface Evaluation {
  id: string;
  institutionId: string;
  title: string;
  description: string | null;
  version: number;
  status: EvaluationStatus;
  courseSubjectId: string;
  academicYearId: string;
  periodId: string | null;
  teacherId: string;
  bookletNumber: number | null;
  /** Tipo de cuadernillo configurado por el admin en la Prueba.
   *  Null = formulación sin tipo asignado (evaluaciones previas a
   *  ago 2026 o formulaciones "sin cuadernillo" como diagnósticas). */
  bookletTypeId: string | null;
  totalQuestions: number;
  /**
   * Duración estimada en minutos, capturada por el docente en el panel
   * Settings. Nullable: si es null, la portada del cuadernillo cae al cálculo
   * heurístico (`totalQuestions * DEFAULT_MINUTES_PER_QUESTION`). Editable
   * mientras la evaluation esté en DRAFT; inmutable desde APPROVED.
   */
  durationMinutes: number | null;
  /** Override visual por formulación (modo Diseñador). JSON crudo de la BD. */
  theme: unknown;
}

/** Bloque de contexto: agrupa preguntas bajo un texto/imagen/tabla común. */
export interface EvaluationSection {
  id: string;
  title: string | null;
  content: unknown; // TipTap JSON
  order: number;
  questions: Question[];
}

export interface Question {
  id: string;
  number: number;
  text: unknown; // TipTap JSON (soporta KaTeX)
  image: string | null;
  // sectionId real persistido (ago 2026): algunas rutas crean/renombran
  // secciones server-side antes de guardar la pregunta, así que el
  // sectionId que el cliente envió puede no coincidir con el real. El
  // orquestador del editor unificado usa este campo para sincronizar
  // `targetSectionId` con la verdad del servidor tras el guardado.
  sectionId: string;
  options: QuestionOption[];
  correctAnswer: AnswerKey;
  justification: string | null;
  weight: number;
  soloLevel: SoloLevel | null;
  menComponent: string | null;
  competency: string | null;
}

export interface QuestionOption {
  key: AnswerKey;
  text: unknown; // TipTap JSON
}

/** Formulación con su contenido completo (bloques + preguntas). */
export interface EvaluationDetail extends Evaluation {
  sections: EvaluationSection[];
  /** Nombre del periodo académico (nullable: la formulación se puede crear
   *  sin periodo, ej. evaluación diagnóstica de inicio de año). El
   *  repositorio hidrata este campo con un include extra; los casos donde
   *  no se necesita (solo IDs) pueden seguir usando `Evaluation.periodId`.
   *  Es opcional para que los in-memory repos de tests no tengan que
   *  setearlo (cuando lo omiten, las pages deben tratar `null` como
   *  "sin periodo"). */
  periodName?: string | null;
  /** Nombre del tipo de cuadernillo (nullable). El repo hidrata este
   *  campo con `include: { bookletType: { select: { name: true } } }`. */
  bookletTypeName?: string | null;
  /** Nombre de la asignatura (nullable defensivo). El repo hidrata este
   *  campo con `include: { courseSubject: { subject: { name } } }`. Lo
   *  consume el editor unificado para componer el header
   *  `${periodName} ${subjectName} ${courseName} ${bookletTypeName}`
   *  (ago 2026). */
  subjectName?: string | null;
  /** Nombre del curso / grado (nullable defensivo). El repo hidrata este
   *  campo con `include: { courseSubject: { course: { name } } }`. */
  courseName?: string | null;
}

/** Fila de listado enriquecida con nombres de curso/asignatura/periodo. */
export interface EvaluationListItem {
  id: string;
  title: string;
  status: EvaluationStatus;
  version: number;
  bookletNumber: number | null;
  totalQuestions: number;
  /** Curso al que pertenece (vía courseSubject). Sprint 9: el wizard de
   *  cuadernillos filtra los candidatos por este campo. */
  courseId: string;
  courseName: string;
  subjectName: string;
  /** courseSubject al que pertenece. Ago 2026: el form de creación lo
   *  usa para detectar duplicados (mismo courseSubjectId + periodId) y
   *  redirigir al docente a la formulación existente en lugar de fallar. */
  courseSubjectId: string;
  /** Periodo académico (nullable: la formulación se puede crear sin
   *  periodo, ej. evaluación diagnóstica de inicio de año). */
  periodId: string | null;
  periodName: string | null;
  /** Tipo de cuadernillo (nullable). */
  bookletTypeId: string | null;
  bookletTypeName: string | null;
  /** Año académico al que pertenece la formulación. Ago 2026: el listado
   *  'Mis formulaciones' lo muestra como columna propia para que el docente
   *  distinga formulaciones del año actual vs. años anteriores sin tener que
   *  entrar a cada una. */
  academicYearYear: number;
  updatedAt: Date;
}

// ===== Datos de creación =====

export interface CreateEvaluationData {
  title: string;
  courseSubjectId: string;
  periodId?: string;
  bookletNumber?: number;
  description?: string;
  /** Tipo de cuadernillo seleccionado. Si se omite, la formulación queda
   *  sin tipo asignado. Si se envía, el use case valida que pertenezca al
   *  mismo `periodId` de la formulación y a la misma institución. */
  bookletTypeId?: string;
  /** Duración estimada en minutos. Si es `null` o se omite, cae al cálculo
   *  heurístico `totalQuestions * DEFAULT_MINUTES_PER_QUESTION`. Mismas
   *  reglas de validación que `UpdateEvaluationSettingsData`. Sprint 7. */
  durationMinutes?: number | null;
}

export interface CreateSectionData {
  title?: string;
  content?: unknown; // TipTap JSON; por defecto vacío
}

/** Edición de un contexto. Campos ausentes = no se tocan. */
export interface UpdateSectionData {
  /** `null` limpia el título (el contexto pasa a rotularse "Contexto N"). */
  title?: string | null;
  content?: unknown; // TipTap JSON
}

/**
 * Edición de una pregunta. Campos ausentes = no se tocan.
 *
 * `options` se reemplaza entero (no se hace merge por clave): editar una
 * pregunta de 4 opciones a 3 debe poder eliminar la sobrante, y casar
 * parcialmente por clave dejaría huérfana la D.
 */
export interface UpdateQuestionData {
  text?: unknown; // TipTap JSON
  options?: { key: AnswerKey; text: unknown }[];
  correctAnswer?: AnswerKey;
  justification?: string | null;
  weight?: number;
  soloLevel?: SoloLevel | null;
  menComponent?: string | null;
  competency?: string | null;
  image?: string | null;
}

export interface CreateQuestionData {
  text: unknown; // TipTap JSON
  options: { key: AnswerKey; text: unknown }[];
  correctAnswer: AnswerKey;
  justification?: string;
  weight?: number;
  soloLevel?: SoloLevel | null;
  menComponent?: string | null;
  competency?: string | null;
  image?: string;
  /** Si se importó del banco: id de la pregunta origen (copia independiente). */
  bankOriginId?: string;
}

// ===== Puerto de persistencia =====

/** Datos editables desde el panel Settings de la evaluation (Sprint 7).
 *  Solo `durationMinutes` por ahora. Si en el futuro hay más campos del
 *  "metadata" (e.g. instrucciones de portada), se añaden aquí manteniendo
 *  la regla "editable en DRAFT, congelado desde APPROVED". */
export interface UpdateEvaluationSettingsData {
  durationMinutes: number | null;
}

export interface EvaluationRepository {
  create(institutionId: string, teacherId: string, data: CreateEvaluationData): Promise<Evaluation>;
  findById(institutionId: string, id: string): Promise<Evaluation | null>;
  getDetail(institutionId: string, id: string): Promise<EvaluationDetail | null>;
  findByTeacher(institutionId: string, teacherId: string): Promise<EvaluationListItem[]>;
  findByInstitution(
    institutionId: string,
    status?: EvaluationStatus,
  ): Promise<EvaluationListItem[]>;
  addSection(
    institutionId: string,
    evaluationId: string,
    data: CreateSectionData,
  ): Promise<EvaluationSection>;
  updateSection(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    data: UpdateSectionData,
  ): Promise<EvaluationSection>;

  /**
   * Elimina el contexto y, en cascada, sus preguntas. Renumera las preguntas
   * restantes de la formulación y recalcula `totalQuestions`.
   */
  deleteSection(institutionId: string, evaluationId: string, sectionId: string): Promise<void>;

  /** Crea la pregunta y recalcula totalQuestions de la formulación. */
  addQuestion(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    data: CreateQuestionData,
  ): Promise<Question>;

  updateQuestion(
    institutionId: string,
    evaluationId: string,
    questionId: string,
    data: UpdateQuestionData,
  ): Promise<Question>;

  /**
   * Devuelve el `sectionId` de la pregunta indicada, o `null` si no existe.
   * Usado por `DeleteQuestion` para resolver la sección dueña antes de
   * borrarla y poder evaluar la cascada de sección vacía.
   *
   * El `institutionId` se valida aquí (no basta con `sectionId` solo)
   * porque la pregunta es globalmente única por id pero la verificación
   * de pertenencia a la institución se hace por la relación
   * `section.evaluationId = evaluationId ∧ evaluation.institutionId = ...`.
   */
  findQuestionSectionId(
    institutionId: string,
    evaluationId: string,
    questionId: string,
  ): Promise<string | null>;

  /**
   * Elimina la pregunta, renumera las siguientes para que la numeración siga
   * siendo continua (la hoja OMR la asume así) y recalcula `totalQuestions`.
   */
  deleteQuestion(institutionId: string, evaluationId: string, questionId: string): Promise<void>;

  /**
   * Cuenta cuántas preguntas vivas tiene una sección. Usado por el use case
   * `DeleteQuestion` para la cascada: tras eliminar la pregunta, si la
   * sección queda con 0 preguntas, también se borra la sección (queda
   * huérfana sin preguntas que la justifiquen).
   *
   * NO se acopla al ciclo de vida de la pregunta — la sección puede tener
   * preguntas en cualquier `number`, basta con `count > 0` para NO borrarla.
   */
  countQuestionsInSection(sectionId: string): Promise<number>;

  /**
   * Duplica la pregunta: clona enunciado, opciones, correctAnswer, peso y
   * metadatos (justificación, competencia, etc.) en una pregunta nueva al
   * final de la formulación. La copia queda con `bankOriginId = null` (ya no
   * es del banco, es una instancia propia editable con independencia total).
   * Incrementa `totalQuestions` en 1.
   */
  duplicateQuestion(institutionId: string, evaluationId: string, questionId: string): Promise<void>;

  /**
   * Reordena las preguntas de una sección según el orden de
   * `orderedQuestionIds`. Renumera `number` 1..N consecutivamente en el
   * evaluation (la hoja OMR asume numeración continua) y recalcula
   * `totalQuestions`. Las IDs deben pertenecer a la sección de la
   * evaluation dada — cualquier ID ajena lanza `ValidationError`.
   */
  reorderQuestions(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    orderedQuestionIds: string[],
  ): Promise<void>;
  updateStatus(institutionId: string, id: string, status: EvaluationStatus): Promise<void>;
  /**
   * Actualiza los campos de metadata editables desde el panel Settings
   * (hoy solo `durationMinutes`). El use case `UpdateEvaluationSettings`
   * se encarga de validar DRAFT-only antes de invocar este método.
   */
  updateSettings(
    institutionId: string,
    id: string,
    data: UpdateEvaluationSettingsData,
  ): Promise<Evaluation>;
  /** Cada aprobación crea una copia inmutable con version + 1 (§3.3). */
  createNewVersion(institutionId: string, id: string): Promise<Evaluation>;
  /**
   * Indica si ya existe una formulación (no borrada) en la institución con
   * la misma combinación `courseSubjectId + periodId + academicYearId`. La
   * validación la usa `CreateEvaluation` para impedir duplicados. Si
   * `periodId` es `null`, se compara solo con formulaciones sin periodo
   * asignado en ese año académico y asignatura-curso.
   */
  existsByCourseSubjectPeriodBookletTypeYear(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
    bookletTypeId: string | null,
    academicYearId: string,
  ): Promise<boolean>;
}

/** Cota inferior y superior para `durationMinutes` (Sprint 7).
 *  - Mín 1: una evaluation sin tiempo no se imprime.
 *  - Máx 600 min = 10h: tope defensivo contra valores absurdos que rompan
 *    la maquetación del booklet. Ninguna clase real dura más. */
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 600;

/** Valida `durationMinutes` para `UpdateEvaluationSettingsData`.
 *  Devuelve `null` si es válido, mensaje de error si no.
 *  Trata `null` como válido (la portada cae al cálculo heurístico). */
export function validateDurationMinutes(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    return "La duración debe ser un número entero de minutos.";
  }
  if (value < MIN_DURATION_MINUTES) {
    return `La duración mínima es ${MIN_DURATION_MINUTES} minuto.`;
  }
  if (value > MAX_DURATION_MINUTES) {
    return `La duración máxima es ${MAX_DURATION_MINUTES} minutos (10 horas).`;
  }
  return null;
}

const ANSWER_KEYS: AnswerKey[] = ["A", "B", "C", "D", "E", "F", "G", "H"];
/** Lista ordenada de las claves posibles (A→H). Útil para construir
 *  inputs en formularios y validar formas. */
export const ANSWER_KEYS_ORDER: readonly AnswerKey[] = ANSWER_KEYS;

/** Mínimo y máximo de opciones por pregunta.
 *  - Mín. 2: para verdadero/falso o tricotomía.
 *  - Máx. 8: la hoja de respuestas tiene 8 columnas (A–H) fijas; las
 *    preguntas con menos opciones simplemente dejan las restantes en
 *    blanco. Esto simplifica la impresión (grilla uniforme) y el OMR
 *    (siempre escanea 8 columnas por pregunta). */
/**
 * Numeración continua 1..N de las preguntas de una formulación, en el orden en
 * que se imprimen: contextos por `order`, preguntas por `number` dentro de
 * cada uno. El llamador debe pasar `sections` ya ordenada.
 *
 * Se usa tras borrar una pregunta o un contexto. El cuadernillo numera de
 * corrido en toda la formulación y la hoja OMR asume esa correspondencia, así
 * que un hueco desalinearía las burbujas respecto de las respuestas.
 *
 * Devuelve **solo las preguntas cuyo número cambia**, para no escribir filas
 * que ya están bien (borrar la última pregunta no debe tocar ninguna otra).
 */
export function computeRenumbering(
  sections: Array<{ questions: Array<{ id: string; number: number }> }>,
): { updates: Array<{ id: string; number: number }>; total: number } {
  const updates: Array<{ id: string; number: number }> = [];
  let next = 1;
  for (const section of sections) {
    for (const q of section.questions) {
      if (q.number !== next) updates.push({ id: q.id, number: next });
      next++;
    }
  }
  return { updates, total: next - 1 };
}

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/** Una pregunta válida: entre MIN_OPTIONS y MAX_OPTIONS opciones (A–H)
 *  con una correcta entre ellas. El contexto (sección) es OPCIONAL: la
 *  pregunta puede agregarse sin contexto y queda agrupada en la sección
 *  "Sin contexto" (o en la auto-creada al abrir el editor unificado).
 *
 *  NOTA: la validación del contenido (enunciado + texto de cada opción) se
 *  hace en los USE CASES (`AddQuestion`, validador de import). Esta función
 *  mantiene la API histórica `options + correctAnswer` para que las pruebas
 *  unitarias que validan solo la forma A–D + correcta sigan compilando. */
export function validateQuestionShape(data: {
  options: { key: AnswerKey }[];
  correctAnswer: AnswerKey;
}): string | null {
  if (data.options.length < MIN_OPTIONS || data.options.length > MAX_OPTIONS) {
    return `La pregunta debe tener entre ${MIN_OPTIONS} y ${MAX_OPTIONS} opciones (A–H).`;
  }
  const keys = data.options.map((o) => o.key);
  const unique = new Set(keys);
  const expected = ANSWER_KEYS.slice(0, data.options.length);
  if (unique.size !== data.options.length || !expected.every((k) => unique.has(k))) {
    return `Las opciones deben ser ${expected.join(", ")}.`;
  }
  if (!keys.includes(data.correctAnswer)) {
    return `La respuesta correcta debe estar entre las opciones definidas (${expected.join(", ")}).`;
  }
  return null;
}

/**
 * Valida el CONTENIDO de una pregunta a guardar: enunciado no vacío y todas
 * las opciones con texto no vacío. Corre en los use cases de ALTA / UPDATE
 * (no en `validateQuestionShape`, que solo verifica la forma A–D).
 *
 * Devuelve `null` si está OK, o un mensaje de error para mostrar inline.
 *
 * ago 2026: antes se usaba `richTextToPlain(...).trim()` que solo extrae
 * texto, lo cual rechazaba enunciados u opciones de solo imagen/tabla/
 * fórmula. El docente pidió permitir guardar si hay solo imágenes
 * (image-only TipTaps son contenido renderizable válido). Ahora usamos
 * `richTextHasRenderableContent` que cuenta imágenes, tablas, fórmulas y
 * otros nodos no-texto como contenido. `richTextToPlain` se mantiene para
 * snippets e impresión (ahí sí queremos solo el texto).
 */
export function validateQuestionContent(data: {
  text: unknown;
  options: { key: AnswerKey; text: unknown }[];
}): string | null {
  if (!richTextHasRenderableContent(data.text)) {
    return "Describe el enunciado de la pregunta.";
  }
  for (const opt of data.options) {
    if (!richTextHasRenderableContent(opt.text)) {
      return `Llena la opción ${opt.key} antes de guardar.`;
    }
  }
  return null;
}
