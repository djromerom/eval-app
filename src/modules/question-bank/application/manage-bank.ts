import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import {
  type EvaluationRepository,
  type Question,
  validateQuestionShape,
} from "@/modules/evaluations/domain/evaluation";
import {
  type BankQuestion,
  type BankQuestionFilters,
  type BankQuestionRepository,
  type CreateBankQuestionData,
} from "../domain/bank-question";

export interface CreateBankQuestionInput {
  actor: AuthenticatedUser;
  data: CreateBankQuestionData;
}

/** Crea una pregunta de banco (personal o institucional). §3.3 */
export class CreateBankQuestion implements UseCase<CreateBankQuestionInput, BankQuestion> {
  constructor(private readonly bank: BankQuestionRepository) {}

  async execute({ actor, data }: CreateBankQuestionInput): Promise<Result<BankQuestion>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    if (!data.subjectId) return fail(new ValidationError("La asignatura es obligatoria."));
    const shapeError = validateQuestionShape(data);
    if (shapeError) return fail(new ValidationError(shapeError));

    return ok(await this.bank.create(actor.institutionId, actor.userId, data));
  }
}

export interface SearchBankQuestionsInput {
  actor: AuthenticatedUser;
  filters: BankQuestionFilters;
}

export class SearchBankQuestions implements UseCase<SearchBankQuestionsInput, BankQuestion[]> {
  constructor(private readonly bank: BankQuestionRepository) {}

  async execute({ actor, filters }: SearchBankQuestionsInput): Promise<Result<BankQuestion[]>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;
    return ok(await this.bank.search(actor.institutionId, actor.userId, filters));
  }
}

export interface ImportBankQuestionInput {
  actor: AuthenticatedUser;
  bankQuestionId: string;
  evaluationId: string;
  sectionId: string;
}

/**
 * Importa una pregunta del banco a una formulación creando una **copia
 * independiente** (editar el banco no afecta la formulación). §3.3
 */
export class ImportBankQuestion implements UseCase<ImportBankQuestionInput, Question> {
  constructor(
    private readonly bank: BankQuestionRepository,
    private readonly evaluations: EvaluationRepository,
  ) {}

  async execute({
    actor,
    bankQuestionId,
    evaluationId,
    sectionId,
  }: ImportBankQuestionInput): Promise<Result<Question>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const evaluation = await this.evaluations.findById(actor.institutionId, evaluationId);
    if (!evaluation) return fail(new NotFoundError("Formulación", evaluationId));
    if (evaluation.teacherId !== actor.userId) {
      return fail(new ValidationError("Solo el autor puede editar la formulación."));
    }
    if (evaluation.status !== "DRAFT") {
      return fail(new ValidationError("Solo se puede editar una formulación en BORRADOR."));
    }

    const source = await this.bank.findVisible(actor.institutionId, actor.userId, bankQuestionId);
    if (!source) return fail(new NotFoundError("Pregunta de banco", bankQuestionId));

    const question = await this.evaluations.addQuestion(
      actor.institutionId,
      evaluationId,
      sectionId,
      {
        text: source.text,
        options: source.options,
        correctAnswer: source.correctAnswer,
        justification: source.justification ?? undefined,
        soloLevel: source.soloLevel,
        menComponent: source.menComponent,
        competency: source.competency,
        bankOriginId: source.id,
      },
    );
    return ok(question);
  }
}

export interface ExportQuestionToBankInput {
  actor: AuthenticatedUser;
  evaluationId: string;
  questionId: string;
  subjectId: string;
  isPersonal?: boolean;
  tags?: string[];
  difficulty?: CreateBankQuestionData["difficulty"];
}

/** Exporta una pregunta de una formulación al banco (copia independiente). §3.3 */
export class ExportQuestionToBank implements UseCase<ExportQuestionToBankInput, BankQuestion> {
  constructor(
    private readonly bank: BankQuestionRepository,
    private readonly evaluations: EvaluationRepository,
  ) {}

  async execute(input: ExportQuestionToBankInput): Promise<Result<BankQuestion>> {
    const { actor, evaluationId, questionId, subjectId, isPersonal, tags, difficulty } = input;
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    const detail = await this.evaluations.getDetail(actor.institutionId, evaluationId);
    if (!detail) return fail(new NotFoundError("Formulación", evaluationId));

    const question = detail.sections.flatMap((s) => s.questions).find((q) => q.id === questionId);
    if (!question) return fail(new NotFoundError("Pregunta", questionId));

    return ok(
      await this.bank.create(actor.institutionId, actor.userId, {
        subjectId,
        text: question.text,
        options: question.options,
        correctAnswer: question.correctAnswer,
        justification: question.justification ?? undefined,
        soloLevel: question.soloLevel,
        menComponent: question.menComponent,
        competency: question.competency,
        difficulty,
        tags,
        isPersonal,
      }),
    );
  }
}
