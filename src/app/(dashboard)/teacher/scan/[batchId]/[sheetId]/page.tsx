import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { renderRichText, unwrapSingleParagraph } from "@/components/editor/render";
import { SheetMatrix } from "./sheet-matrix";
import { ReprocessButton } from "./reprocess-button";
import type { BubbleCellRecord, GridLayoutRecord } from "@/modules/scanning/domain/answer-sheet";

interface PageProps {
  params: Promise<{ batchId: string; sheetId: string }>;
}

export default async function SheetDetailPage({ params }: PageProps) {
  const { batchId, sheetId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  // Multi-tenant: el sheet debe pertenecer a la institución del actor y a
  // un lote que sea del docente actual (evaluation) o de la institución
  // (bundle). Mismo filtro que `reprocessSheetAction`.
  const sheet = await prisma.answerSheet.findFirst({
    where: {
      id: sheetId,
      scanBatchId: batchId,
      OR: [
        {
          evaluation: {
            institutionId: actor.institutionId,
            teacherId: actor.userId,
            deletedAt: null,
          },
        },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    include: {
      scanBatch: { include: { evaluation: true, bundle: true } },
    },
  });
  if (!sheet) notFound();

  // Traemos las respuestas + la pregunta (texto + opciones) + el ítem de
  // bundle si aplica. Ordenamos por el orden natural (createdAt) para
  // preservar la numeración con la que el worker escribió los records.
  const answers = await prisma.studentAnswer.findMany({
    where: { answerSheetId: sheet.id },
    orderBy: { id: "asc" },
    include: {
      question: {
        include: { options: { orderBy: { key: "asc" } } },
      },
      bundleItem: true,
    },
  });

  // Construimos el array de filas para la matriz.
  type Row = {
    questionId: string;
    questionNumber: number | null;
    questionHtml: string;
    cells: BubbleCellRecord[];
    selectedKey: string | null;
    correctKey: string;
    isCorrect: boolean | null;
    isAmbiguous: boolean;
    fillRatio: number | null;
  };

  const rows: Row[] = answers.map((a) => {
    const rawCells = (a.cells as unknown as BubbleCellRecord[] | null) ?? [];
    return {
      questionId: a.questionId,
      // En bundle el "número" humano vive en bundleItem.order; en legacy
      // lo derivaría de Question.number dentro de la sección.
      questionNumber: a.bundleItem?.order ?? null,
      questionHtml: "",
      cells: rawCells,
      selectedKey: a.selectedKey,
      correctKey: a.question.correctAnswer,
      isCorrect: a.isCorrect,
      isAmbiguous: a.isAmbiguous,
      fillRatio: a.fillRatio,
    };
  });

  // Texto de cada pregunta (lazy-fetch del sub-set de preguntas que
  // necesitamos; el include ya vino, pero aquí proyectamos para enviar
  // solo lo necesario al cliente).
  const questionTexts = new Map<string, { text: unknown; number: number | null }>();
  for (const a of answers) {
    questionTexts.set(a.questionId, {
      text: a.question.text,
      number: a.bundleItem?.order ?? null,
    });
  }

  const gridLayout = (sheet.gridLayout as unknown as GridLayoutRecord | null) ?? null;
  const detectionConfidence = sheet.detectionConfidence;
  const isProcessing = sheet.status === "PROCESSING";

  const answerKeys = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

  return (
    <>
      <PageHeader
        title={`Hoja ${sheet.studentName ?? sheet.studentCode ?? sheet.id.slice(0, 8)}`}
        description={
          sheet.scanBatch?.bundle
            ? `Compendio: ${sheet.scanBatch.bundle.name}`
            : sheet.scanBatch?.evaluation
              ? `Evaluación: ${sheet.scanBatch.evaluation.title}`
              : "Hoja de respuestas"
        }
      />

      <section className="bg-card mb-6 space-y-4 rounded-xl border p-6">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <ScanStatusBadge status={sheet.status} size="lg" />
          {sheet.score != null && (
            <span className="font-semibold">
              {sheet.totalCorrect ?? 0}/{sheet.totalQuestions ?? "?"} = {sheet.score.toFixed(1)}
            </span>
          )}
          {sheet.studentName && (
            <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
              {sheet.studentName}
            </span>
          )}
          {sheet.studentCode && (
            <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
              Código {sheet.studentCode}
            </span>
          )}
          {detectionConfidence != null && (
            <span
              className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs"
              title="Confianza de la auto-detección de burbujas"
            >
              Detección: {(detectionConfidence * 100).toFixed(0)}%
            </span>
          )}
          {gridLayout?.fallbackUsed && (
            <span
              className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
              title="La auto-detección no encontró suficientes burbujas y cayó al layout calibrado."
            >
              Layout calibrado (fallback)
            </span>
          )}
          <span className="ml-auto">
            <ReprocessButton
              sheetId={sheet.id}
              batchId={sheet.scanBatchId ?? batchId}
              disabled={isProcessing}
            />
          </span>
        </div>
        {sheet.notes && (
          <div className="bg-muted/30 text-muted-foreground rounded p-3 text-xs">
            <span className="font-semibold">Notas del worker:</span> {sheet.notes}
          </div>
        )}
        <div>
          <Link
            href="/teacher/scan"
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            ← Volver al listado
          </Link>
        </div>
      </section>

      <section className="bg-card rounded-xl border p-6">
        <h2 className="mb-4 font-semibold">Matriz de respuestas</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Cada celda muestra la respuesta leída por el escáner. Pasa el cursor sobre las celdas para
          ver el porcentaje de relleno. Haz click para abrir el detalle de la pregunta.
        </p>
        <SheetMatrix
          rows={rows.map((r) => ({
            questionId: r.questionId,
            questionNumber: r.questionNumber,
            questionTextHtml: renderTextPreview(questionTexts.get(r.questionId)?.text),
            cells: r.cells,
            selectedKey: r.selectedKey,
            correctKey: r.correctKey,
            isCorrect: r.isCorrect,
            isAmbiguous: r.isAmbiguous,
            fillRatio: r.fillRatio,
          }))}
          answerKeys={answerKeys}
          processedImagePath={sheet.processedImage ? `/api/scans/${sheet.processedImage}` : null}
        />
      </section>
    </>
  );
}

/** Server-side: convierte el JSON TipTap a un HTML resumido (server-safe).
 *  Cortamos a 280 chars para que la matriz no se llene de párrafos largos;
 *  el modal abre el detalle completo. */
function renderTextPreview(text: unknown): string {
  const html = unwrapSingleParagraph(renderRichText(text));
  return html.length > 280 ? `${html.slice(0, 280)}…` : html;
}
