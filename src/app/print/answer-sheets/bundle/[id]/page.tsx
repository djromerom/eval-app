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

interface BundleQuestionRow {
  /** Posición global dentro de la hoja (1..N). */
  globalNumber: number;
  /** Etiqueta local de la pregunta (dentro de su evaluación). */
  localNumber: number;
  /** Número de opciones para el ancho de fila (2..8). */
  optionsLength: number;
  /** Sección y evaluación de origen (para el separador visual). */
  sectionTitle: string | null;
  evaluationTitle: string;
  questionId: string;
}

interface BundleSection {
  evaluationTitle: string;
  evaluationId: string;
  itemId: string;
  sectionTitle: string | null;
  questions: BundleQuestionRow[];
}

/**
 * Render server-side de la hoja de respuestas UNIFICADA del compendio.
 * Lo abre el worker de Puppeteer con un token firmado (kind = "answer-sheets-bundle").
 *
 * Estructura: una hoja por estudiante con TODAS las preguntas del bundle,
 * numeración global continua, y separadores visuales por sección (área +
 * asignatura + bloque). El QR lleva `bundle` (no `eval`) para que el OMR
 * worker pueda reconstruir el orden global al calificar (ver Sprint 2 del
 * módulo compendios).
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

  // Cargar questions + sections de cada evaluation del bundle en orden.
  // Esto hace N+1 queries; aceptable para una hoja de respuestas que se
  // imprime una vez por período. Si se vuelve cuello de botella, batch con
  // prisma.evaluation.findMany + include.
  const sections: BundleSection[] = [];
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
      const questions: BundleQuestionRow[] = section.questions.map((q) => ({
        globalNumber: globalCounter++,
        localNumber: q.number,
        optionsLength: q.options.length,
        sectionTitle: section.title,
        evaluationTitle: evaluation.title,
        questionId: q.id,
      }));
      sections.push({
        evaluationTitle: evaluation.title,
        evaluationId: evaluation.id,
        itemId: item.id,
        sectionTitle: section.title,
        questions,
      });
    }
  }

  const totalQuestions = globalCounter - 1;

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
          {totalQuestions} preguntas, {sections.length} contexto(s))
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR" className="as-qr" />
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

            {/* Grid: una sección por bloque (separador visual) */}
            <div className="as-grid">
              {sections.map((section, sIdx) => (
                <div key={`${section.evaluationId}-${sIdx}`} className="as-section">
                  <div className="as-section-header">
                    <strong>{section.evaluationTitle}</strong>
                    {section.sectionTitle ? <> · {section.sectionTitle}</> : null}
                    <span className="text-muted-foreground ml-2 text-[8pt]">
                      ({section.questions.length} preguntas)
                    </span>
                  </div>
                  <div className="as-grid-header">
                    <div className="as-grid-corner">N.º</div>
                    {KEYS.map((k) => (
                      <div key={k} className="as-grid-key">
                        {k}
                      </div>
                    ))}
                  </div>
                  {section.questions.map((q) => (
                    <div key={q.questionId} className="as-grid-row">
                      <div className="as-grid-num">{q.globalNumber}</div>
                      {KEYS.slice(0, q.optionsLength).map((k) => (
                        <div key={k} className="as-grid-bubble">
                          <div className="omr-bubble" />
                        </div>
                      ))}
                      {/* Padding para mantener alineamiento cuando optionsLength < 8 */}
                      {KEYS.slice(q.optionsLength).map((k) => (
                        <div key={k} className="as-grid-bubble">
                          {/* burbuja vacía reservada — el OMR la ignora */}
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
