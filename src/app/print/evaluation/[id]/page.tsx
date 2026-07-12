import type { Metadata } from "next";
import "@/styles/print.css";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { isPrintable } from "@/modules/evaluations/domain/evaluation-status";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Vista previa de impresión" };

const INSTRUCTIONS = [
  "Lee cada pregunta cuidadosamente y elige UNA opción.",
  "La hoja de respuestas será entregada por separado por el docente.",
  "Por favor, responde TODAS las preguntas.",
  "Esta prueba brindará información sobre los aprendizajes para mejorar dentro del aula de clase y sirve como insumo para la planeación de clases.",
];

const KEYS = ["A", "B", "C", "D"] as const;

function contextText(content: unknown): string | null {
  return typeof content === "string" && content.trim() ? content : null;
}

/**
 * Vista previa / impresión de una evaluación como cartilla ICFES (§3.4).
 * El mismo marcado se ve como hojas en pantalla y se imprime en doble carta
 * horizontal (Print CSS @page). Validar el formato contra
 * Prueba__11º_I_periodo_C3__1_.pdf.
 */
export default async function PrintEvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser();

  const [evalRes, instRes, csRes] = await Promise.all([
    makeGetEvaluation().execute({ actor, id }),
    makeGetMyInstitution().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
  ]);
  if (!evalRes.ok) notFound();

  const evaluation = evalRes.value;
  const institutionName = instRes.ok ? instRes.value.name : "";
  const cs = csRes.ok ? csRes.value.find((c) => c.id === evaluation.courseSubjectId) : undefined;
  const grade = cs?.courseName ?? "";
  const area = cs?.subjectName ?? "";
  const bookletLabel = `CUADERNILLO ${evaluation.bookletNumber ?? 1}`;

  return (
    <div className="booklet">
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          Vista previa de impresión
          {!isPrintable(evaluation.status)
            ? " — la evaluación aún no está PUBLICADA (borrador de referencia)."
            : "."}
        </span>
        <PrintButton />
      </div>

      {/* ===== Página 1: portada ===== */}
      <section className="sheet cover">
        <p className="cover-institution">{institutionName}</p>
        <p className="cover-test-title">{evaluation.title}</p>
        <p className="cover-grade">{grade ? `Grado ${grade}` : ""}</p>

        <p className="cover-booklet-number">{bookletLabel}</p>

        <p className="cover-greeting">¡Hola!</p>
        <p className="cover-instructions-title">Instrucciones</p>
        <p className="cover-instructions-intro">
          A continuación encontrarás una serie de preguntas de selección múltiple. Lee con atención
          y responde en la hoja de respuestas.
        </p>
        <ul className="cover-instructions-list">
          {INSTRUCTIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <div className="mark-example">
          <span>Marca así:</span>
          {KEYS.map((k) => (
            <span key={k} className={`omr-bubble${k === "A" ? "filled" : ""}`}>
              {k}
            </span>
          ))}
        </div>

        <div className="student-fields">
          <div>Nombre:</div>
          <div>Grado:</div>
          <div>Fecha:</div>
        </div>
      </section>

      {/* ===== Páginas 2+: preguntas ===== */}
      <section className="sheet questions">
        <div className="page-header">
          <span>{institutionName}</span>
          <span>{bookletLabel}</span>
        </div>
        {area ? <p className="subject-title">{area}</p> : null}

        {evaluation.sections.length === 0 ? (
          <p className="context-paragraph">Esta evaluación aún no tiene contenido.</p>
        ) : (
          evaluation.sections.map((section) => {
            const numbers = section.questions.map((q) => q.number);
            const first = numbers[0];
            const last = numbers[numbers.length - 1];
            const context = contextText(section.content);
            return (
              <div key={section.id}>
                {numbers.length > 0 ? (
                  <p className="block-lead">
                    Responda las preguntas {first} a la {last}
                    {context || section.title ? " de acuerdo con la siguiente información" : ""}
                  </p>
                ) : null}
                {section.title ? <p className="block-text-title">«{section.title}»</p> : null}
                {context ? <p className="context-paragraph">{context}</p> : null}

                {section.questions.map((q) => (
                  <div key={q.id} className="question">
                    <p className="question-text">
                      {q.number}. {String(q.text)}
                    </p>
                    <ul className="question-options">
                      {q.options.map((o) => (
                        <li key={o.key}>
                          {o.key}. {String(o.text)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
