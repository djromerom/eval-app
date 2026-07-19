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
  totalQuestions: number;
  /**
   * Duración estimada en minutos, capturada por el docente en el panel
   * Settings. Nullable: si es null, la portada del compendio cae al cálculo
   * heurístico (`totalQuestions * DEFAULT_MINUTES_PER_QUESTION`). Editable
   * mientras la evaluation esté en DRAFT; inmutable desde APPROVED.
   */
  durationMinutes: number | null;
  /** Override visual por evaluación (modo Diseñador). JSON crudo de la BD. */
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

/** Evaluación con su contenido completo (bloques + preguntas). */
export interface EvaluationDetail extends Evaluation {
  sections: EvaluationSection[];
}

/** Fila de listado enriquecida con nombres de curso/asignatura. */
export interface EvaluationListItem {
  id: string;
  title: string;
  status: EvaluationStatus;
  version: number;
  bookletNumber: number | null;
  totalQuestions: number;
  /** Curso al que pertenece (vía courseSubject). Sprint 9: el wizard de
   *  compendios filtra los candidatos por este campo. */
  courseId: string;
  courseName: string;
  subjectName: string;
  updatedAt: Date;
}

// ===== Datos de creación =====

export interface CreateEvaluationData {
  title: string;
  courseSubjectId: string;
  periodId?: string;
  bookletNumber?: number;
  description?: string;
  /** Duración estimada en minutos. Si es `null` o se omite, cae al cálculo
   *  heurístico `totalQuestions * DEFAULT_MINUTES_PER_QUESTION`. Mismas
   *  reglas de validación que `UpdateEvaluationSettingsData`. Sprint 7. */
  durationMinutes?: number | null;
}

export interface CreateSectionData {
  title?: string;
  content?: unknown; // TipTap JSON; por defecto vacío
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
  /** Crea la pregunta y recalcula totalQuestions de la evaluación. */
  addQuestion(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    data: CreateQuestionData,
  ): Promise<Question>;
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
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/** Una pregunta válida: entre MIN_OPTIONS y MAX_OPTIONS opciones (A–H)
 *  con una correcta entre ellas. */
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
