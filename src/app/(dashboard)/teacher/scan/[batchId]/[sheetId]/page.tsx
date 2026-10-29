import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { requireAuthenticatedUser } from "@/lib/session";
import { safeReturnPath } from "@/shared/domain/return-path";
import { hasRole } from "@/shared/application/authenticated-user";
import { PageHeader } from "@/components/page-header";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { renderRichText, unwrapSingleParagraph } from "@/components/editor/render";
import { SheetMatrix } from "./sheet-matrix";
import { ReprocessButton } from "./reprocess-button";
import { MarcarRevisadaButton } from "./marcar-revisada-button";
import { AsignarEstudianteButton, type StudentOption } from "./asignar-estudiante-button";
import type { BubbleCellRecord, GridLayoutRecord } from "@/modules/scanning/domain/answer-sheet";
import { loadDisabledQuestionIds } from "@/modules/bundles/infrastructure/container";

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
      scanBatch: {
        include: {
          evaluation: true,
          bundle: {
            include: {
              items: {
                select: {
                  evaluation: { select: { courseSubject: { select: { courseId: true } } } },
                },
              },
            },
          },
        },
      },
      // El estudiante asociado (puede ser null si el QR no fue decodificado
      // y nadie asignó manualmente todavía). Lo incluimos acá para que la
      // cabecera y los badges reflejen al estudiante en cuanto se asigna,
      // sin tener que reescribir `studentName`/`studentCode` en la action.
      student: {
        select: {
          id: true,
          code: true,
          lastName1: true,
          lastName2: true,
          firstName1: true,
          firstName2: true,
          group: { select: { name: true } },
        },
      },
    },
  });
  if (!sheet) notFound();

  // Selector de estudiante manual: cuando el worker no detectó el QR y la hoja
  // quedó sin `studentId`, y el lote viene de un Cuadernillo (los formularios
  // sueltos no ofrecen este flujo). La lista se trae solo si hace falta para
  // no pagar la query en cada render del detalle.
  const mostrarPicker = !sheet.studentId && sheet.scanBatch?.bundle != null;
  const courseIds = mostrarPicker
    ? [...new Set(sheet.scanBatch!.bundle!.items.map((i) => i.evaluation.courseSubject.courseId))]
    : [];
  const studentsForPicker: StudentOption[] = mostrarPicker
    ? (
        await prisma.student.findMany({
          where: {
            institutionId: actor.institutionId,
            isActive: true,
            deletedAt: null,
            group: { courseId: { in: courseIds } },
          },
          select: {
            id: true,
            code: true,
            lastName1: true,
            lastName2: true,
            firstName1: true,
            firstName2: true,
            group: { select: { name: true } },
          },
          orderBy: [{ lastName1: "asc" }, { lastName2: "asc" }, { firstName1: "asc" }],
        })
      ).map((s) => ({
        id: s.id,
        code: s.code,
        name: nombreCompleto(s),
        groupName: s.group.name,
      }))
    : [];

  // Preguntas inhabilitadas del cuadernillo: se muestran con "No cuenta" en
  // lugar de ✓/✗, porque no suman a la nota guardada de la hoja.
  const disabledIds = sheet.bundleId
    ? await loadDisabledQuestionIds(sheet.bundleId)
    : new Set<string>();

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
    disabled: boolean;
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
      disabled: disabledIds.has(a.questionId),
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

  // Recorte del bloque Nombre/Grado/Código impreso. Solo existe cuando el motor
  // no pudo leer el QR: en ese caso la hoja llega sin estudiante y hay que
  // identificarla a mano. Se lee del mismo JSON de detección que ya persiste el
  // worker (`persistCells`), así que no cuesta una llamada al servicio ni una
  // columna nueva. Se pide únicamente si falta el estudiante: con QR legible el
  // campo viene vacío y leer el archivo sería trabajo tirado.
  const identidad = sheet.studentId
    ? { crop: null as string | null, ocr: null as string | null }
    : await leerIdentidadImpresa(batchId, sheet.id);

  const gridLayout = (sheet.gridLayout as unknown as GridLayoutRecord | null) ?? null;
  const detectionConfidence = sheet.detectionConfidence;
  const isProcessing = sheet.status === "PROCESSING";

  const answerKeys = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

  // Lo que mostramos al usuario sobre la identidad de la hoja. Tiene dos
  // fuentes y la regla es clara: la relación `student` es la verdad cuando
  // está (sea por QR o por asignación manual); los campos guardados
  // `studentName`/`studentCode` son respaldo legible del QR o del
  // handwriting y solo aparecen si no hay `student` ligado. Sin esta
  // triada, tras una asignación manual la cabecera seguía diciendo
  // "Hoja <8 chars del UUID>".
  const displayName = sheet.student
    ? nombreCompleto(sheet.student)
    : (sheet.studentName ?? sheet.studentCode ?? sheet.id.slice(0, 8));
  const displayCode = sheet.student?.code ?? sheet.studentCode ?? null;
  const displayGroup = sheet.student?.group.name ?? null;

  return (
    <>
      <PageHeader
        title={`Hoja ${displayName}`}
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
          {displayName && displayName !== sheet.id.slice(0, 8) && (
            <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
              {displayName}
            </span>
          )}
          {displayGroup && (
            <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
              {displayGroup}
            </span>
          )}
          {displayCode && (
            <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
              Código {displayCode}
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
          {/* Solo tiene sentido confirmar una hoja observada y con nota: sin
              puntaje no hay calificación que confirmar, y fuera de REVIEW no
              hay observaciones que revisar. Mismas guardas que la action. */}
          {puedeReprocesar && sheet.status === "REVIEW" && sheet.score !== null && (
            <span className="ml-auto">
              <MarcarRevisadaButton sheetId={sheet.id} batchId={sheet.scanBatchId ?? batchId} />
            </span>
          )}
          {puedeReprocesar && (
            <span>
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
        {identidad.crop && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 text-sm text-amber-900">
              <strong>QR no legible.</strong>{" "}
              {identidad.ocr ? (
                <>
                  El código impreso dice{" "}
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 font-mono font-semibold">
                    {identidad.ocr}
                  </span>
                  , leído por OCR: confírmalo contra la imagen antes de asignar.
                </>
              ) : (
                "Identifica la hoja con los datos impresos:"
              )}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/jpeg;base64,${identidad.crop}`}
              alt="Nombre, grado y código impresos en la hoja"
              className="w-full max-w-md rounded border bg-white"
            />
          </div>
        )}
        {mostrarPicker && (
          <AsignarEstudianteButton
            sheetId={sheet.id}
            batchId={sheet.scanBatchId ?? batchId}
            students={studentsForPicker}
          />
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
              Mostrando solo <strong>{asignatura}</strong> — {rows.length} de {todasLasFilas.length}{" "}
              ítems de la hoja.
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
            disabled: r.disabled,
          }))}
          answerKeys={answerKeys}
          processedImagePath={sheet.processedImage ? `/api/scans/${sheet.processedImage}` : null}
        />
      </section>
    </>
  );
}

/** Lee del JSON de detección persistido el recorte del bloque de identidad y el
 *  código sugerido por OCR. Devuelve nulos ante cualquier fallo: es información
 *  de ayuda, y una hoja vieja procesada antes de esta función simplemente no lo
 *  trae. Misma ruta que `api/scans/cells/[batchId]/[sheetId]` — si cambia allá,
 *  cambia acá. */
async function leerIdentidadImpresa(
  batchId: string,
  sheetId: string,
): Promise<{ crop: string | null; ocr: string | null }> {
  try {
    const buf = await localStorage.read(`scans/${batchId}/sheet_${sheetId}_cells.json`);
    const data = JSON.parse(buf.toString("utf-8")) as {
      idCrop?: string;
      idOcr?: string | null;
    };
    return { crop: data.idCrop || null, ocr: data.idOcr || null };
  } catch {
    return { crop: null, ocr: null };
  }
}

/** Server-side: convierte el JSON TipTap a un HTML resumido (server-safe).
 *  Cortamos a 280 chars para que la matriz no se llene de párrafos largos;
 *  el modal abre el detalle completo. */
function renderTextPreview(text: unknown): string {
  const html = unwrapSingleParagraph(renderRichText(text));
  return html.length > 280 ? `${html.slice(0, 280)}…` : html;
}

/** Formato legible "APELLIDO1 APELLIDO2, NOMBRE1 NOMBRE2". Mismo criterio que
 *  calificaciones-fetcher.ts: cualquier parte vacía se omite, sin coma colgante.
 *  Lo necesitamos acá porque el selector de estudiante manual es server-rendered
 *  y debe mostrar el nombre antes del click. */
function nombreCompleto(s: {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
}): string {
  const apellidos = [s.lastName1, s.lastName2].filter(Boolean).join(" ").trim();
  const nombres = [s.firstName1, s.firstName2].filter(Boolean).join(" ").trim();
  return [apellidos, nombres].filter(Boolean).join(", ");
}
