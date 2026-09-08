import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/answer-sheet.css";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";
import {
  buildSignedQrContent,
  generateQrDataUrl,
} from "@/modules/printing/infrastructure/qr-generator";

export const metadata: Metadata = { title: "Hoja de respuestas" };

/** 8 columnas fijas (A–H). Las preguntas con menos opciones dejan las
 *  restantes en blanco. Ver evaluations/domain/evaluation.ts. */
const KEYS = ANSWER_KEYS_ORDER;

/** Reparte en 1–3 columnas (sep 2026). Regla del docente:
 *  - chunks de 40 preguntas por columna (no equitativo)
 *  - máximo 3 columnas
 *  - la última columna absorbe el resto (puede tener < 40 si no se llega,
 *    o > 40 si se supera el cap de 3 × 40 = 120)
 *
 *  Antes: siempre 3 columnas equitativas (`Math.ceil(N/3)` cada una).
 *  Estilo PDF institucional María Doraliza: las preguntas fluyen en orden
 *  1..N a través de las columnas. */
function splitIntoColumns<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]];
  const CHUNK = 40;
  const MAX_COLS = 3;
  const cols: T[][] = [];
  for (let i = 0; i < MAX_COLS && i * CHUNK < items.length; i++) {
    const isLastSlot = i === MAX_COLS - 1 || (i + 1) * CHUNK >= items.length;
    const end = isLastSlot ? items.length : (i + 1) * CHUNK;
    cols.push(items.slice(i * CHUNK, end));
  }
  return cols;
}

interface Props {
  params: Promise<{ evaluationId: string }>;
}

export default async function AnswerSheetPage({ params }: Props) {
  const { evaluationId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  const [evalRes, instRes] = await Promise.all([
    makeGetEvaluation().execute({ actor, id: evaluationId }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!evalRes.ok) notFound();

  const evaluation = evalRes.value;
  const institutionName = instRes.ok ? instRes.value.name : "";
  const allQuestions = evaluation.sections.flatMap((s) => s.questions);
  const columns = splitIntoColumns(allQuestions);

  const qrPayload = {
    inst: instRes.ok ? instRes.value.code : "",
    eval: evaluation.id,
    student: "",
    sheet: crypto.randomUUID(),
    ts: Date.now(),
  };
  const signed = buildSignedQrContent(qrPayload);
  const qrDataUrl = await generateQrDataUrl(signed);

  return (
    <div className="answer-sheet booklet">
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">Hoja de respuestas — {evaluation.title}</span>
      </div>

      <section className="sheet answer-sheet-content">
        <div className="as-header">
          <div className="as-institution">{institutionName}</div>
          <div className="as-title">{evaluation.title}</div>
        </div>

        <div className="as-body">
          {/* QR + student fields */}
          <div className="as-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR" className="as-qr" />
            <div className="as-student-fields">
              <div className="as-field">
                <span>Nombre:</span>
                <span className="as-line" />
              </div>
              <div className="as-field">
                <span>Grado:</span>
                <span className="as-line" />
              </div>
              <div className="as-field">
                <span>Fecha:</span>
                <span className="as-line" />
              </div>
            </div>
          </div>

          {/* 1–3 columnas de burbujas según `splitIntoColumns` (sep 2026).
              Estilo PDF institucional María Doraliza. */}
          <div
            className="as-grid"
            style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
          >
            {columns.map((col, colIdx) => (
              <div key={colIdx} className="as-col">
                {col.map((q) => (
                  <div key={q.id} className="as-col-row">
                    <div className="as-col-num">{q.number}</div>
                    {KEYS.slice(0, q.options.length).map((k) => (
                      <div key={k} className="as-col-bubble">
                        <div className="omr-bubble">{k}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
