import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";

export type Difficulty = "EASY" | "MEDIUM" | "HARD";

export interface BankQuestion {
  id: string;
  institutionId: string;
  subjectId: string;
  text: unknown; // TipTap JSON
  options: { key: AnswerKey; text: unknown }[];
  correctAnswer: AnswerKey;
  soloLevel: SoloLevel | null;
  menComponent: string | null;
  difficulty: Difficulty;
  tags: string[];
  isPersonal: boolean; // true = solo visible para su creador
  createdBy: string;
}
