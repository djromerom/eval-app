import type { EvaluationStatus } from "./evaluation-status";

export type AnswerKey = "A" | "B" | "C" | "D";

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
  /** Cada aprobación crea una copia inmutable con version + 1 (§3.3). */
  createNewVersion(institutionId: string, id: string): Promise<Evaluation>;
}

const ANSWER_KEYS: AnswerKey[] = ["A", "B", "C", "D"];
/** Lista ordenada de las claves posibles (A→D). Útil para construir
 *  inputs en formularios y validar formas. */
export const ANSWER_KEYS_ORDER: readonly AnswerKey[] = ANSWER_KEYS;

/** Mínimo y máximo de opciones por pregunta.
 *  - Mín. 2: para verdadero/falso o tricotomía.
 *  - Máx. 4: la hoja de respuestas institucional y el detector OMR solo
 *    tienen columnas A–D (plantilla ICFES); exceder 4 produciría una
 *    pregunta que el estudiante no puede marcar ni el scanner detectar.
 *  Si en el futuro se imprime una hoja con más columnas, basta con
 *  extender AnswerKey + ANSWER_KEYS y subir este tope. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

/** Una pregunta ICFES válida: entre 2 y 4 opciones (A–D) con una correcta entre ellas. */
export function validateQuestionShape(data: {
  options: { key: AnswerKey }[];
  correctAnswer: AnswerKey;
}): string | null {
  if (data.options.length < MIN_OPTIONS || data.options.length > MAX_OPTIONS) {
    return `La pregunta debe tener entre ${MIN_OPTIONS} y ${MAX_OPTIONS} opciones (A–D).`;
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
