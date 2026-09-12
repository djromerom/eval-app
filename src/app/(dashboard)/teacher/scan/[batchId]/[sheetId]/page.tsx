import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { requireAuthenticatedUser } from "@/lib/session";
import { safeReturnPath } from "@/shared/domain/return-path";
import { hasRole } from "@/shared/application/authenticated-user";
import { PageHeader } from "@/components/page-header";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { renderRichText, unwrapSingleParagraph } from "@/components/editor/render";
import { SheetMatrix } from "./sheet-matrix";
import { ReprocessButton } from "./reprocess-button";
import type { BubbleCellRecord, GridLayoutRecord } from "@/modules/scanning/domain/answer-sheet";

interface PageProps {
  params: Promise<{ batchId: string; sheetId: string }>;
  /** `volver`: a dónde apunta el enlace de retorno. A esta pantalla se llega
   *  desde el lote y también desde la consulta de calificaciones; sin esto el
   *  "Volver" siempre devolvía al módulo de escaneo, dejando al usuario en
   *  otro lado del que venía. Se valida (ver `safeReturnPath`).
   *
   *  `soloLectura`: oculta las acciones que modifican la hoja. Es una bandera
   *  propia y no se deduce de `volver` a propósito — mezclar "de dónde vengo"
   *  con "qué puedo hacer" haría que agregar un enlace desde otra pantalla
   *  cambiara los permisos aparentes sin que nadie lo pida. */
  searchParams?: Promise<{ volver?: string; soloLectura?: string; asignatura?: string }>;
}

export default async function SheetDetailPage({ params, searchParams }: PageProps) {
  const { batchId, sheetId } = await params;
  const sp = (await searchParams) ?? {};
  const volverA = safeReturnPath(sp.volver, "/teacher/scan");
  // ECU_MASTER incluido para igualar la pantalla del lote, que ya lo admite:
  // sin esto, abrir el detalle desde la consulta de calificaciones lo
  // redirigia a "/" sin explicacion.
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  // Dos motivos para no ofrecer el reproceso, y conviene que sean explícitos:
  //   1. Se llegó en modo consulta: ahí se viene a leer, no a operar el lote.
  //   2. El actor no tiene el rol que exige `reprocessSheetAction`. Sin esto
  //      un ECU_MASTER veía el botón y la acción se lo rechazaba — ocultar el
  //      botón NO es la barrera (esa la pone la action), pero mostrar uno que
  //      no funciona es peor que no mostrarlo.
  const puedeReprocesar = sp.soloLectura !== "1" && hasRole(actor, "TEACHER", "ECU_LIDER");

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
      bundleItem: {
        include: {
          evaluation: {
            select: { courseSubject: { select: { subject: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  // Construimos el array de filas para la matriz.
  type Row = {
    questionId: string;
    questionNumber: number | null;
    questionHtml: string;
    cells: BubbleCellRecord[];
    /** Posición del ítem en la hoja completa, 1-based. Es la clave de los
     *  recortes del motor OMR y sobrevive a cualquier filtrado de la tabla —
     *  por eso se fija acá y no se deriva del índice del array. */
    posicion: number;
    subjectName: string | null;
    optionKeys: string[];
    selectedKey: string | null;
    correctKey: string;
    isCorrect: boolean | null;
    isAmbiguous: boolean;
    fillRatio: number | null;
  };

  const todasLasFilas: Row[] = answers.map((a, idx) => {
    const rawCells = (a.cells as unknown as BubbleCellRecord[] | null) ?? [];
    return {
      questionId: a.questionId,
      // `answers` viene ordenado por id ascendente, que es el orden en que el
      // worker recorrió las preguntas detectadas: idx + 1 === n del motor.
      posicion: idx + 1,
      subjectName: a.bundleItem?.evaluation?.courseSubject?.subject?.name ?? null,
      // En bundle el "número" humano vive en bundleItem.order; en legacy
      // lo derivaría de Question.number dentro de la sección.
      questionNumber: a.bundleItem?.order ?? null,
      questionHtml: "",
      cells: rawCells,
      // Opciones reales del ítem. Una hoja mezcla preguntas de 4 y de 8
      // opciones; sin esto la matriz pinta A-H en todas y sugiere que una
      // pregunta de 4 tenía respuestas E-H que el estudiante dejó vacías.
      optionKeys: a.question.options.map((o) => o.key),
      selectedKey: a.selectedKey,
      correctKey: a.question.correctAnswer,
      isCorrect: a.isCorrect,
      isAmbiguous: a.isAmbiguous,
      fillRatio: a.fillRatio,
    };
  });

  // Filtro por asignatura: se aplica DESPUÉS de fijar `posicion`, para que los
  // recortes del motor sigan apuntando al ítem correcto. Se filtra por nombre
  // de materia y no por id de bundleItem porque así coincide exactamente con
  // el agrupamiento del resumen, que también agrupa por nombre.
  const asignatura = sp.asignatura?.trim() || null;
  const rows = asignatura
    ? todasLasFilas.filter((r) => (r.subjectName ?? "Sin asignatura") === asignatura)
    : todasLasFilas;

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
            ? `Cuadernillo: ${sheet.scanBatch.bundle.name}`
            : sheet.scanBatch?.evaluation
              ? `Formulación: ${sheet.scanBatch.evaluation.title}`
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
          {puedeReprocesar && (
            <span className="ml-auto">
              <ReprocessButton
                sheetId={sheet.id}
                batchId={sheet.scanBatchId ?? batchId}
                disabled={isProcessing}
              />
            </span>
          )}
        </div>
        {sheet.notes && (
          <div className="bg-muted/30 text-muted-foreground rounded p-3 text-xs">
            <span className="font-semibold">Notas del worker:</span> {sheet.notes}
          </div>
        )}
        <div>
          <Link
            href={volverA}
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            ← Volver
          </Link>
        </div>
      </section>

      <section className="bg-card rounded-xl border p-6">
        <h2 className="mb-4 font-semibold">Matriz de respuestas</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Cada celda muestra la respuesta leída por el escáner. Pasa el cursor sobre las celdas para
          ver el porcentaje de relleno. Haz click para abrir el detalle de la pregunta.
        </p>
        {asignatura && (
          // Visible y con salida: sin esto, alguien que llega por un enlace
          // filtrado cree que la hoja tiene 10 items en vez de 95.
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
            <span>
              Mostrando solo <strong>{asignatura}</strong> — {rows.length} de{" "}
              {todasLasFilas.length} ítems de la hoja.
            </span>
            <Link
              href={`/teacher/scan/${batchId}/${sheetId}?${new URLSearchParams({
                ...(sp.soloLectura === "1" ? { soloLectura: "1" } : {}),
                ...(sp.volver ? { volver: sp.volver } : {}),
              }).toString()}`}
              className="text-primary underline underline-offset-2"
            >
              Ver todas las asignaturas
            </Link>
          </div>
        )}
        <SheetMatrix
          batchId={batchId}
          sheetId={sheet.id}
          rows={rows.map((r) => ({
            questionId: r.questionId,
            questionNumber: r.questionNumber,
            questionTextHtml: renderTextPreview(questionTexts.get(r.questionId)?.text),
            cells: r.cells,
            posicion: r.posicion,
            optionKeys: r.optionKeys,
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
