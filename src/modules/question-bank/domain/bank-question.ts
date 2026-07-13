import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export interface BankQuestion {
  id: string;
  institutionId: string;
  subjectId: string;
  subjectName: string;
  text: unknown; // TipTap JSON
  options: { key: AnswerKey; text: unknown }[];
  correctAnswer: AnswerKey;
  justification: string | null;
  soloLevel: SoloLevel | null;
  menComponent: string | null;
  competency: string | null;
  difficulty: Difficulty;
  tags: string[];
  isPersonal: boolean; // true = solo visible para su creador
  createdBy: string;
}

export interface CreateBankQuestionData {
  subjectId: string;
  text: unknown;
  options: { key: AnswerKey; text: unknown }[];
  correctAnswer: AnswerKey;
  justification?: string;
  soloLevel?: SoloLevel | null;
  menComponent?: string | null;
  competency?: string | null;
  difficulty?: Difficulty;
  tags?: string[];
  isPersonal?: boolean;
}

/** Filtros de búsqueda combinables (§3.3 Banco de Preguntas). */
export interface BankQuestionFilters {
  subjectId?: string;
  soloLevel?: SoloLevel;
  difficulty?: Difficulty;
  tags?: string[];
  /** Coincidencia en el texto plano del enunciado. */
  search?: string;
  /** true = solo el banco personal del actor. */
  onlyMine?: boolean;
}

export interface BankQuestionRepository {
  create(
    institutionId: string,
    createdBy: string,
    data: CreateBankQuestionData,
  ): Promise<BankQuestion>;
  /** Visible si es institucional o personal del propio usuario. */
  findVisible(institutionId: string, userId: string, id: string): Promise<BankQuestion | null>;
  search(
    institutionId: string,
    userId: string,
    filters: BankQuestionFilters,
  ): Promise<BankQuestion[]>;
}
