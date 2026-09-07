import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { prisma } from "@/shared/infrastructure/db/prisma";
import {
  computeCompareReport,
  type CompareReportQuestionInput,
  type CompareReportItemInput,
} from "@/modules/bundles/domain/compare-report";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reporte comparativo del cuadernillo" };

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/**
 * Reporte comparativo entre las evaluations de un bundle. Muestra:
 *   - Stats globales: total preguntas, total hojas escaneadas.
 *   - Tabla por evaluation: correctRate medio y dificultad.
 *   - Tabla por pregunta: correctRate y answeredCount (numeración global).
 *   - Sprint 4: drill-down por hoja × item (correctRate por estudiante
 *     en cada evaluation del cuadernillo). Solo si los StudentAnswer
 *     tienen bundleItemId poblado (i.e. calificados con la nueva versión
 *     del worker OMR).
 *
 * Ver docs/cuadernillos.md §"Sprint 3 — Reporte comparativo" y §"Sprint 4".
 */
export default async function BundleReportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER", "SUPER_ADMIN");
  const { id } = await params;

  const bundleRes = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleRes.ok) notFound();
  const bundle = bundleRes.value;

  // Hojas escaneadas del bundle. Tenancy ya viene del bundle, que pertenece
  // a actor.institutionId por `makeGetBundle()` más arriba.
  const sheets = await prisma.answerSheet.findMany({
    where: { bundleId: id },
    include: {
      student: {
        select: {
          lastName1: true,
          lastName2: true,
          firstName1: true,
          firstName2: true,
          code: true,
        },
      },
    },
  });

  // Cargar las questions de las evaluations del bundle en orden global.
  // Mapeamos questionId → bundleItemId para el drill-down de Sprint 4.
  const questionsMeta: CompareReportQuestionInput[] = [];
  const itemIds: string[] = [];
  const items: CompareReportItemInput[] = bundle.items.map((it) => {
    itemIds.push(it.id);
    return {
      bundleItemId: it.id,
      evaluationId: it.evaluationId,
      evaluationTitle: it.evaluationTitle,
      totalQuestions: it.totalQuestions,
    };
  });

  // Traemos todos los items con sus sections/questions para mapear
  // questionId → bundleItemId sin recargar uno por uno.
  const bundleItems = await prisma.evaluationBundleItem.findMany({
    where: { id: { in: itemIds } },
    include: {
      evaluation: {
        include: {
          sections: {
            orderBy: { order: "asc" },
            include: { questions: { orderBy: { number: "asc" }, select: { id: true } } },
          },
        },
      },
    },
  });
  for (const item of bundleItems) {
    const evTitle = items.find((i) => i.bundleItemId === item.id)?.evaluationTitle ?? "";
    for (const section of item.evaluation.sections) {
      for (const q of section.questions) {
        questionsMeta.push({
          id: q.id,
          bundleItemId: item.id,
          evaluationId: item.evaluation.id,
          evaluationTitle: evTitle,
        });
      }
    }
  }
  const questionIds = questionsMeta.map((q) => q.id);

  // Traer las respuestas de todas las hojas para esas preguntas.
  const answers = await prisma.studentAnswer.findMany({
    where: {
      questionId: { in: questionIds },
      answerSheet: { bundleId: id },
    },
    select: { answerSheetId: true, questionId: true, bundleItemId: true, isCorrect: true },
  });

  // Grouped 1: por questionId → isCorrect[]
  const answersByQuestion = new Map<string, Array<boolean | null>>();
  for (const a of answers) {
    const list = answersByQuestion.get(a.questionId) ?? [];
    list.push(a.isCorrect);
    answersByQuestion.set(a.questionId, list);
  }

  // Grouped 2 (Sprint 4): por sheetId → {questionId, bundleItemId, isCorrect}[]
  const answersBySheet = new Map<
    string,
    Array<{ questionId: string; bundleItemId: string | null; isCorrect: boolean | null }>
  >();
  for (const a of answers) {
    const list = answersBySheet.get(a.answerSheetId) ?? [];
    list.push({
      questionId: a.questionId,
      bundleItemId: a.bundleItemId,
      isCorrect: a.isCorrect,
    });
    answersBySheet.set(a.answerSheetId, list);
  }

  // Etiquetas legibles de cada hoja (para el drill-down).
  const sheetLabels = new Map<string, { name: string | null; code: string | null }>();
  for (const sh of sheets) {
    const sName = sh.student
      ? `${sh.student.lastName1} ${sh.student.lastName2} ${sh.student.firstName1} ${sh.student.firstName2}`
          .replace(/\s+/g, " ")
          .trim()
      : "";
    sheetLabels.set(sh.id, {
      name: sName || sh.studentName,
      code: sh.student?.code ?? sh.studentCode,
    });
  }

  const report = computeCompareReport({
    bundleId: bundle.id,
    items,
    questions: questionsMeta,
    totalScannedSheets: sheets.length,
    answersByQuestion,
    answersBySheet,
    sheetLabels,
  });

  return (
    <>
      <PageHeader
        title={`Reporte — ${bundle.name}`}
        description={
          <>
            Comparativa entre las {bundle.items.length} formulaciones del cuadernillo. Datos basados
            en las {report.totalScannedSheets} hoja(s) escaneada(s).
          </>
        }
      />

      <div className="mb-4 flex items-center justify-between">
        <Link
          href={`/admin/bundles/${bundle.id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← Volver al cuadernillo
        </Link>
      </div>

      {report.totalScannedSheets === 0 ? (
        <p className="bg-card text-muted-foreground rounded-xl border p-6 text-sm">
          Aún no se han escaneado hojas para este cuadernillo. El reporte se habilitará cuando los
          estudiantes empiecen a responder.
        </p>
      ) : (
        <>
          {/* Tabla por evaluation */}
          <section className="bg-card mb-6 overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground border-b text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Formulación</th>
                  <th className="px-4 py-3 font-medium">Preguntas</th>
                  <th className="px-4 py-3 font-medium">CorrectRate medio</th>
                  <th className="px-4 py-3 font-medium">Dificultad</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((it) => (
                  <tr key={it.evaluationId} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{it.evaluationTitle}</td>
                    <td className="text-muted-foreground px-4 py-3">{it.totalQuestions}</td>
                    <td className="px-4 py-3">{pct(it.correctRate)}</td>
                    <td className="px-4 py-3">
                      {it.difficulty === null
                        ? "—"
                        : it.difficulty > 0.6
                          ? "Alta"
                          : it.difficulty > 0.3
                            ? "Media"
                            : "Baja"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Tabla por pregunta */}
          <section className="bg-card mb-6 overflow-x-auto rounded-xl border">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">Detalle por pregunta</h2>
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground border-b text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">N.º</th>
                  <th className="px-4 py-2 font-medium">Formulación</th>
                  <th className="px-4 py-2 font-medium">CorrectRate</th>
                  <th className="px-4 py-2 font-medium">Respondidas</th>
                </tr>
              </thead>
              <tbody>
                {report.questions.map((q) => (
                  <tr key={q.questionId} className="border-b last:border-0">
                    <td className="text-muted-foreground px-4 py-2 font-mono text-xs">
                      {q.globalNumber}
                    </td>
                    <td className="px-4 py-2">{q.evaluationTitle}</td>
                    <td className="px-4 py-2">{pct(q.correctRate)}</td>
                    <td className="text-muted-foreground px-4 py-2">{q.answeredCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Sprint 4: Drill-down por hoja × item. Una columna por item. */}
          {report.perSheetBreakdown.length > 0 && (
            <section className="bg-card overflow-x-auto rounded-xl border">
              <h2 className="border-b px-4 py-3 text-sm font-semibold">
                Resultado por estudiante (Sprint 4)
              </h2>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground border-b text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Estudiante</th>
                    {bundle.items.map((it) => (
                      <th key={it.id} className="px-4 py-2 font-medium">
                        {it.evaluationTitle}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.perSheetBreakdown.map((sh) => (
                    <tr key={sh.sheetId} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <div className="font-medium">{sh.studentName ?? "Sin nombre"}</div>
                        <div className="text-muted-foreground text-xs">{sh.studentCode ?? "—"}</div>
                      </td>
                      {bundle.items.map((it) => {
                        const cell = sh.perItem.find((p) => p.bundleItemId === it.id);
                        return (
                          <td key={it.id} className="px-4 py-2">
                            {cell ? (
                              <>
                                <div>{pct(cell.correctRate)}</div>
                                <div className="text-muted-foreground text-xs">
                                  {cell.correctCount}/{cell.questionCount}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
