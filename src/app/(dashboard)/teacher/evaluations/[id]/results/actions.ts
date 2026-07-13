"use server";

import { prisma } from "@/shared/infrastructure/db/prisma";
import { requireAuthenticatedUser } from "@/lib/session";

export interface EvaluationResults {
  totalSheets: number;
  gradedSheets: number;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  totalQuestions: number;
  scoreDistribution: { range: string; count: number }[];
  sheets: SheetSummary[];
  questionStats: QuestionStat[];
}

export interface SheetSummary {
  id: string;
  studentName: string | null;
  studentCode: string | null;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  status: string;
  batchId: string | null;
}

export interface QuestionStat {
  number: number;
  total: number;
  correct: number;
  incorrect: number;
  ambiguous: number;
  unanswered: number;
  accuracy: number | null;
}

export async function getEvaluationResultsAction(
  evaluationId: string,
): Promise<EvaluationResults | null> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const evaluation = await prisma.evaluation.findFirst({
    where: { id: evaluationId, institutionId: actor.institutionId, deletedAt: null },
  });
  if (!evaluation) return null;

  const sheets = await prisma.answerSheet.findMany({
    where: { evaluationId },
    include: {
      answers: { select: { isCorrect: true, isAmbiguous: true, questionId: true } },
      scanBatch: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const sections = await prisma.evaluationSection.findMany({
    where: { evaluationId },
    include: {
      questions: { select: { id: true, number: true }, orderBy: { number: "asc" } },
    },
    orderBy: { order: "asc" },
  });
  const allQuestions = sections.flatMap((s) => s.questions);
  const graded = sheets.filter(
    (s) => s.status === "GRADED" || s.status === "COMPLETED" || s.status === "REVIEW",
  );
  const scores = graded.map((s) => s.score ?? 0);

  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const min = scores.length > 0 ? Math.min(...scores) : null;
  const max = scores.length > 0 ? Math.max(...scores) : null;

  const bins = [0, 1, 2, 3, 4, 5];
  const scoreDistribution = bins.slice(0, -1).map((b) => ({
    range: `${b}.0-${b + 1}.0`,
    count: scores.filter((s) => s >= b && s < b + 1).length,
  }));

  const questionStats: QuestionStat[] = allQuestions.map((q) => {
    const qAnswers = graded.flatMap((s) => s.answers.filter((a) => a.questionId === q.id));

    let correct = 0;
    let incorrect = 0;
    let ambiguous = 0;
    let unanswered = 0;

    for (const a of qAnswers) {
      if (a.isAmbiguous) ambiguous++;
      else if (a.isCorrect === true) correct++;
      else if (a.isCorrect === false) incorrect++;
      else unanswered++;
    }

    const total = qAnswers.length;

    return {
      number: q.number,
      total,
      correct,
      incorrect,
      ambiguous,
      unanswered,
      accuracy: total > 0 ? correct / total : null,
    };
  });

  return {
    totalSheets: sheets.length,
    gradedSheets: graded.length,
    averageScore: avg != null ? Number(avg.toFixed(2)) : null,
    minScore: min,
    maxScore: max,
    totalQuestions: allQuestions.length,
    scoreDistribution,
    sheets: sheets.map((s) => ({
      id: s.id,
      studentName: s.studentName,
      studentCode: s.studentCode,
      score: s.score,
      totalCorrect: s.totalCorrect,
      totalQuestions: s.totalQuestions,
      status: s.status,
      batchId: s.scanBatch?.id ?? null,
    })),
    questionStats,
  };
}

export interface SheetDetail {
  id: string;
  studentName: string | null;
  studentCode: string | null;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  status: string;
  scannedImage: string | null;
  notes: string | null;
  answers: {
    questionNumber: number;
    selectedKey: string | null;
    correctAnswer: string;
    isCorrect: boolean | null;
    isAmbiguous: boolean;
    confidence: number | null;
  }[];
}

export async function getSheetDetailAction(
  evaluationId: string,
  sheetId: string,
): Promise<SheetDetail | null> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const sheet = await prisma.answerSheet.findFirst({
    where: { id: sheetId, evaluationId, evaluation: { institutionId: actor.institutionId } },
    include: {
      answers: {
        include: { question: { select: { number: true, correctAnswer: true } } },
        orderBy: { question: { number: "asc" } },
      },
    },
  });
  if (!sheet) return null;

  return {
    id: sheet.id,
    studentName: sheet.studentName,
    studentCode: sheet.studentCode,
    score: sheet.score,
    totalCorrect: sheet.totalCorrect,
    totalQuestions: sheet.totalQuestions,
    status: sheet.status,
    scannedImage: sheet.scannedImage,
    notes: sheet.notes,
    answers: sheet.answers.map((a) => ({
      questionNumber: a.question.number,
      selectedKey: a.selectedKey,
      correctAnswer: a.question.correctAnswer,
      isCorrect: a.isCorrect,
      isAmbiguous: a.isAmbiguous,
      confidence: a.confidence,
    })),
  };
}
