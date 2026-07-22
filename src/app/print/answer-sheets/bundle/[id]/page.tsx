import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/answer-sheet.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import {
  buildSignedQrContent,
  generateQrDataUrl,
} from "@/modules/printing/infrastructure/qr-generator";

export const metadata: Metadata = { title: "Hojas de respuestas del compendio" };

const KEYS = ANSWER_KEYS_ORDER;

/** Reparte en 3 columnas. La hoja unificada del bundle trata TODAS las
 *  preguntas como una sola lista plana, ignorando secciones y evaluaciones:
 *  la numeración va 1..N de corrido de izquierda a derecha y de arriba abajo. */
function splitIntoColumns<T>(items: T[]): T[][] {
  if (items.length === 0) return [[], [], []];
  const perCol = Math.ceil(items.length / 3);
  return [items.slice(0, perCol), items.slice(perCol, perCol * 2), items.slice(perCol * 2)];
}

interface BundleQuestionRow {
  /** Posición global dentro de la hoja (1..N). */
  globalNumber: number;
  /** Etiqueta local de la pregunta (dentro de su evaluación). */
  localNumber: number;
  /** Número de opciones para el ancho de fila (2..8). */
  optionsLength: number;
  questionId: string;
}

/**
 * Render server-side de la hoja de respuestas UNIFICADA del compendio.
 * Lo abre el worker de Puppeteer con un token firmado (kind = "answer-sheets-bundle").
 *
 * Numeración 1..N contínua a través de TODAS las preguntas de TODAS las
 * evaluaciones y secciones del compendio (sin separadores por sección,
 * sin reinicio por evaluación). El QR lleva `bundle` (no `eval`) para que
 * el OMR worker pueda reconstruir el orden global al calificar
 * (ver Sprint 2 del módulo compendios).
 *
 * La distribución en 3 columnas replica exactamente el estilo del PDF
 * institucional de I.E. María Doraliza López de Mejía: la lista plana se
 * parte en 3 grupos verticalmente (1..N/3, N/3+1..2N/3, 2N/3+1..N).
 */
export default async function BundleAnswerSheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ students?: string; t?: string }>;
}) {
  const { id } = await params;
  const { students: studentIds, t } = await searchParams;

  const actor = await resolvePrintActor(t, { bundleId: id, kind: "answer-sheets-bundle" });

  const [bundleRes, instRes] = await Promise.all([
    makeGetBundle().execute({ actor, bundleId: id }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!bundleRes.ok) notFound();

  const bundle = bundleRes.value;
  const institutionName = instRes.ok ? instRes.value.name : "";
  const institutionCode = instRes.ok ? instRes.value.code : "";

  const ids = studentIds?.split(",").filter(Boolean) ?? [];
  const students =
    ids.length > 0
      ? await prisma.student.findMany({
          where: { id: { in: ids }, institutionId: actor.institutionId },
        })
      : [];

  if (students.length === 0) notFound();

  // Cargar questions de cada evaluation del bundle en orden y aplanarlas.
  // Numeramos de corrido 1..N ignorando secciones y evaluaciones. Esto hace
  // N+1 queries; aceptable para una hoja de respuestas que se imprime una vez
  // por período. Si se vuelve cuello de botella, batch con
  // prisma.evaluation.findMany + include.
  const flatQuestions: BundleQuestionRow[] = [];
  let globalCounter = 1;
  for (const item of bundle.items) {
    const evaluation = await prisma.evaluation.findUnique({
      where: { id: item.evaluationId },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: {
            questions: { orderBy: { number: "asc" }, include: { options: true } },
          },
        },
      },
    });
    if (!evaluation) continue;
    for (const section of evaluation.sections) {
      for (const q of section.questions) {
        flatQuestions.push({
          globalNumber: globalCounter++,
          localNumber: q.number,
          optionsLength: q.options.length,
          questionId: q.id,
        });
      }
    }
  }

  const totalQuestions = flatQuestions.length;
  const columns = splitIntoColumns(flatQuestions);

  // Generar QR por estudiante con payload {bundle, ...} (no eval).
  const sheets = await Promise.all(
    students.map(async (student) => {
      const qrPayload = {
        inst: institutionCode,
        bundle: bundle.id,
        student: student.code,
        sheet: crypto.randomUUID(),
        ts: Date.now(),
      };
      const signed = buildSignedQrContent(qrPayload);
      const qrDataUrl = await generateQrDataUrl(signed);
      return { student, qrDataUrl };
    }),
  );

  return (
    <div className="booklet">
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          {students.length} hoja(s) de respuestas para el compendio &laquo;{bundle.name}&raquo; (
          {totalQuestions} preguntas, {bundle.items.length} evaluación
          {bundle.items.length === 1 ? "" : "es"})
        </span>
      </div>

      {sheets.map(({ student, qrDataUrl }, idx) => (
        <section key={student.id} className="sheet answer-sheet-content">
          <div className="as-header">
            <div className="as-institution">{institutionName}</div>
            <div className="as-title">
              {bundle.name}
              {bundle.bookletNumber ? ` — Cuadernillo ${bundle.bookletNumber}` : ""}
            </div>
          </div>

          <div className="as-body">
            {/* QR + student fields */}
            <div className="as-left">
              {/* `data-omr-qr` lo lee el capturador de geometría (Puppeteer)
                  para registrar la hoja escaneada contra esta plantilla.
                  No afecta al render. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR" className="as-qr" data-omr-qr="1" />
              <div className="as-student-fields">
                <div className="as-field">
                  <span>Nombre:</span>
                  <span className="as-line-filled">{student.name}</span>
                </div>
                <div className="as-field">
                  <span>Código:</span>
                  <span className="as-line-filled">{student.code}</span>
                </div>
                <div className="as-field">
                  <span>Fecha:</span>
                  <span className="as-line" />
                </div>
              </div>
            </div>

            {/* Grid de burbujas (3 columnas, estilo PDF institucional).
                Numeración 1..N plana — sin separadores por sección/evaluación. */}
            <div className="as-grid">
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="as-col">
                  {col.map((q) => (
                    <div key={q.questionId} className="as-col-row">
                      <div className="as-col-num">{q.globalNumber}</div>
                      {KEYS.slice(0, q.optionsLength).map((k) => (
                        <div key={k} className="as-col-bubble">
                          {/* `data-omr-q` / `data-omr-key` permiten al
                              capturador de geometría medir cada burbuja del
                              render REAL y asociarla a (pregunta, opción)
                              sin ambigüedad. Son atributos data-*: no
                              cambian nada de lo que se imprime. */}
                          <div className="omr-bubble" data-omr-q={q.globalNumber} data-omr-key={k}>
                            {k}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="as-footer">
            Hoja {idx + 1} de {sheets.length} · Compendio {bundle.name}
          </div>
        </section>
      ))}
    </div>
  );
}
