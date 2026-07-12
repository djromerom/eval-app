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
  image?: string;
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

/** Una pregunta ICFES válida: 4 opciones A–D distintas y una correcta entre ellas. */
export function validateQuestionShape(data: CreateQuestionData): string | null {
  if (data.options.length !== 4) return "La pregunta debe tener exactamente 4 opciones (A–D).";
  const keys = data.options.map((o) => o.key);
  const unique = new Set(keys);
  if (unique.size !== 4 || !ANSWER_KEYS.every((k) => unique.has(k))) {
    return "Las opciones deben ser exactamente A, B, C y D.";
  }
  if (!ANSWER_KEYS.includes(data.correctAnswer)) {
    return "La respuesta correcta debe ser A, B, C o D.";
  }
  return null;
}
