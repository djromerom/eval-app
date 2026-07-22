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

/** Reparte las preguntas en 3 columnas verticales (estilo PDF institucional
 *  María Doraliza). Si sobran preguntas, la tercera columna las absorbe;
 *  con 110 preguntas: 37 / 37 / 36 — la distribución exacta no importa
 *  mientras las preguntas fluyan en orden 1..N a través de las columnas. */
function splitIntoColumns<T>(items: T[]): T[][] {
  if (items.length === 0) return [[], [], []];
  const perCol = Math.ceil(items.length / 3);
  return [items.slice(0, perCol), items.slice(perCol, perCol * 2), items.slice(perCol * 2)];
}

interface Props {
  params: Promise<{ evaluationId: string }>;
}

export default async function AnswerSheetPage({ params }: Props) {
  const { evaluationId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

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

          {/* 3 columnas de burbujas (estilo PDF institucional) */}
          <div className="as-grid">
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
