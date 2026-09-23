import { type Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  type DisabledBundleQuestion,
  type DisabledBundleQuestionRepository,
} from "../domain/disabled-bundle-question";

/**
 * Adaptador Prisma del repo de inhabitaciones. Las verificaciones de tenant
 * se hacen en el use case (que recibe `institutionId`), no acá.
 *
 * `setDisabled` usa `upsert` con `@@unique([bundleId, questionId])` para que
 * re-toggling sea idempotente. Re-habilitar baja `disabled` a false sin
 * eliminar la fila (decisión deliberada: conservamos la auditoría).
 */
export class PrismaDisabledBundleQuestionRepository implements DisabledBundleQuestionRepository {
  async listActiveByBundle(bundleId: string): Promise<DisabledBundleQuestion[]> {
    const rows = await prisma.disabledBundleQuestion.findMany({
      where: { bundleId, disabled: true },
      orderBy: { disabledAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async setDisabled(args: {
    bundleId: string;
    questionId: string;
    disabled: boolean;
    actorUserId: string;
  }): Promise<DisabledBundleQuestion> {
    const now = new Date();
    const row = await prisma.disabledBundleQuestion.upsert({
      where: {
        bundleId_questionId: {
          bundleId: args.bundleId,
          questionId: args.questionId,
        },
      },
      create: {
        bundleId: args.bundleId,
        questionId: args.questionId,
        disabledAt: now,
        disabledByUserId: args.actorUserId,
        disabled: args.disabled,
      },
      update: {
        disabled: args.disabled,
        disabledAt: now,
        disabledByUserId: args.actorUserId,
      },
    });
    return toDomain(row);
  }

  async listAllQuestionIdsForBundle(bundleId: string): Promise<string[] | null> {
    const bundle = await prisma.evaluationBundle.findUnique({
      where: { id: bundleId },
      select: {
        items: {
          select: {
            evaluation: {
              select: {
                sections: { select: { questions: { select: { id: true } } } },
              },
            },
          },
        },
      },
    });
    if (!bundle) return null;
    const ids = new Set<string>();
    for (const item of bundle.items) {
      for (const section of item.evaluation.sections) {
        for (const q of section.questions) ids.add(q.id);
      }
    }
    return Array.from(ids);
  }

  async effectiveQuestionIds(bundleId: string): Promise<string[] | null> {
    const all = await this.listAllQuestionIdsForBundle(bundleId);
    if (all === null) return null;
    const inactive = await prisma.disabledBundleQuestion.findMany({
      where: { bundleId, disabled: true },
      select: { questionId: true },
    });
    const blocked = new Set(inactive.map((r) => r.questionId));
    return all.filter((qid) => !blocked.has(qid));
  }

  async bundleHasAnyScanBatch(bundleId: string): Promise<boolean> {
    const count = await prisma.scanBatch.count({
      where: { bundleId },
      take: 1,
    });
    return count > 0;
  }

  async listQuestionsForBundle(bundleId: string): Promise<
    | {
        questionId: string;
        evaluationId: string;
        evaluationTitle: string;
        evaluationOrder: number;
        sectionId: string;
        sectionOrder: number;
        sectionTitle: string | null;
        questionNumber: number;
        statementJson: unknown;
      }[]
    | null
  > {
    const bundle = await prisma.evaluationBundle.findUnique({
      where: { id: bundleId },
      select: {
        items: {
          orderBy: { order: "asc" },
          select: {
            order: true,
            evaluation: {
              select: {
                id: true,
                title: true,
                sections: {
                  orderBy: { order: "asc" },
                  select: {
                    id: true,
                    order: true,
                    title: true,
                    questions: {
                      orderBy: { number: "asc" },
                      select: {
                        id: true,
                        number: true,
                        text: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!bundle) return null;

    const rows: {
      questionId: string;
      evaluationId: string;
      evaluationTitle: string;
      evaluationOrder: number;
      sectionId: string;
      sectionOrder: number;
      sectionTitle: string | null;
      questionNumber: number;
      statementJson: unknown;
    }[] = [];
    for (const item of bundle.items) {
      for (const section of item.evaluation.sections) {
        for (const q of section.questions) {
          rows.push({
            questionId: q.id,
            evaluationId: item.evaluation.id,
            evaluationTitle: item.evaluation.title,
            evaluationOrder: item.order,
            sectionId: section.id,
            sectionOrder: section.order,
            sectionTitle: section.title,
            questionNumber: q.number,
            statementJson: q.text,
          });
        }
      }
    }
    return rows;
  }
}

function toDomain(
  row: Prisma.DisabledBundleQuestionGetPayload<Record<string, never>>,
): DisabledBundleQuestion {
  return {
    id: row.id,
    bundleId: row.bundleId,
    questionId: row.questionId,
    disabledAt: row.disabledAt,
    disabledByUserId: row.disabledByUserId,
    disabled: row.disabled,
  };
}
