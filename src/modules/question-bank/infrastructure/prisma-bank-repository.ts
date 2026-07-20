import {
  type Prisma,
  type QuestionDifficulty,
  type SoloLevel as PrismaSoloLevel,
} from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";
import type {
  BankQuestion,
  BankQuestionFilters,
  BankQuestionRepository,
  CreateBankQuestionData,
  Difficulty,
} from "../domain/bank-question";

type BankRow = {
  id: string;
  institutionId: string;
  subjectId: string;
  subject: { name: string };
  text: Prisma.JsonValue;
  correctAnswer: string;
  justification: string | null;
  soloLevel: PrismaSoloLevel | null;
  menComponent: string | null;
  competency: string | null;
  evidence: string | null;
  difficulty: QuestionDifficulty;
  tags: string[];
  isPersonal: boolean;
  createdBy: string;
  options: { key: string; text: Prisma.JsonValue }[];
};

function toBankQuestion(r: BankRow): BankQuestion {
  return {
    id: r.id,
    institutionId: r.institutionId,
    subjectId: r.subjectId,
    subjectName: r.subject.name,
    text: r.text,
    options: r.options.map((o) => ({ key: o.key as AnswerKey, text: o.text })),
    correctAnswer: r.correctAnswer as AnswerKey,
    justification: r.justification,
    soloLevel: (r.soloLevel as SoloLevel | null) ?? null,
    menComponent: r.menComponent,
    competency: r.competency,
    evidence: r.evidence,
    difficulty: r.difficulty as Difficulty,
    tags: r.tags,
    isPersonal: r.isPersonal,
    createdBy: r.createdBy,
  };
}

const include = {
  subject: { select: { name: true } },
  options: { select: { key: true, text: true } },
} as const;

const json = (v: unknown): Prisma.InputJsonValue => (v ?? {}) as Prisma.InputJsonValue;

/** Visibilidad: institucionales de la institución + personales del propio usuario. */
function visibilityFilter(institutionId: string, userId: string): Prisma.QuestionBankWhereInput {
  return {
    institutionId,
    deletedAt: null,
    OR: [{ isPersonal: false }, { isPersonal: true, createdBy: userId }],
  };
}

export class PrismaBankQuestionRepository implements BankQuestionRepository {
  async create(
    institutionId: string,
    createdBy: string,
    data: CreateBankQuestionData,
  ): Promise<BankQuestion> {
    const row = await prisma.questionBank.create({
      data: {
        institutionId,
        createdBy,
        subjectId: data.subjectId,
        text: json(data.text),
        correctAnswer: data.correctAnswer,
        justification: data.justification ?? null,
        soloLevel: (data.soloLevel as PrismaSoloLevel | null) ?? null,
        menComponent: data.menComponent ?? null,
        competency: data.competency ?? null,
        evidence: data.evidence ?? null,
        difficulty: (data.difficulty as QuestionDifficulty | undefined) ?? "MEDIUM",
        tags: data.tags ?? [],
        isPersonal: data.isPersonal ?? false,
        options: { create: data.options.map((o) => ({ key: o.key, text: json(o.text) })) },
      },
      include,
    });
    return toBankQuestion(row);
  }

  /**
   * Alta masiva en UNA transacción: o entran todas o ninguna. Se usa
   * `create` por fila (no `createMany` de Prisma) porque cada pregunta trae
   * sus opciones en una tabla aparte, y `createMany` no admite relaciones
   * anidadas.
   */
  async createMany(
    institutionId: string,
    createdBy: string,
    data: CreateBankQuestionData[],
  ): Promise<number> {
    if (data.length === 0) return 0;
    await prisma.$transaction(
      data.map((q) =>
        prisma.questionBank.create({
          data: {
            institutionId,
            createdBy,
            subjectId: q.subjectId,
            text: json(q.text),
            correctAnswer: q.correctAnswer,
            justification: q.justification ?? null,
            soloLevel: (q.soloLevel as PrismaSoloLevel | null) ?? null,
            menComponent: q.menComponent ?? null,
            competency: q.competency ?? null,
            evidence: q.evidence ?? null,
            difficulty: (q.difficulty as QuestionDifficulty | undefined) ?? "MEDIUM",
            tags: q.tags ?? [],
            isPersonal: q.isPersonal ?? false,
            options: { create: q.options.map((o) => ({ key: o.key, text: json(o.text) })) },
          },
        }),
      ),
    );
    return data.length;
  }

  async findVisible(
    institutionId: string,
    userId: string,
    id: string,
  ): Promise<BankQuestion | null> {
    const row = await prisma.questionBank.findFirst({
      where: { id, ...visibilityFilter(institutionId, userId) },
      include,
    });
    return row && toBankQuestion(row);
  }

  async search(
    institutionId: string,
    userId: string,
    filters: BankQuestionFilters,
  ): Promise<BankQuestion[]> {
    const where: Prisma.QuestionBankWhereInput = {
      ...visibilityFilter(institutionId, userId),
      ...(filters.onlyMine ? { createdBy: userId, isPersonal: true } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(filters.soloLevel ? { soloLevel: filters.soloLevel as PrismaSoloLevel } : {}),
      ...(filters.difficulty ? { difficulty: filters.difficulty as QuestionDifficulty } : {}),
      ...(filters.tags && filters.tags.length > 0 ? { tags: { hasSome: filters.tags } } : {}),
      // El enunciado es JSON de TipTap (o texto plano por ahora): filtro por string.
      ...(filters.search ? { text: { string_contains: filters.search } as Prisma.JsonFilter } : {}),
    };
    const rows = await prisma.questionBank.findMany({
      where,
      include,
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return rows.map(toBankQuestion);
  }
}
