import { PrismaEvaluationRepository } from "@/modules/evaluations/infrastructure/prisma-evaluation-repository";
import { optionRules } from "@/modules/option-rules/infrastructure/container";
import {
  CreateBankQuestion,
  ExportQuestionToBank,
  ImportBankQuestion,
  SearchBankQuestions,
} from "../application/manage-bank";
import { PrismaBankQuestionRepository } from "./prisma-bank-repository";

/** Composition root del módulo question-bank. */
const bank = new PrismaBankQuestionRepository();
const evaluations = new PrismaEvaluationRepository();

export const makeCreateBankQuestion = () => new CreateBankQuestion(bank, optionRules);
export const makeSearchBankQuestions = () => new SearchBankQuestions(bank);
export const makeImportBankQuestion = () => new ImportBankQuestion(bank, evaluations, optionRules);
export const makeExportQuestionToBank = () =>
  new ExportQuestionToBank(bank, evaluations, optionRules);
