import type { Metadata } from "next";
import "@/styles/print.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { isPrintable } from "@/modules/evaluations/domain/evaluation-status";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { RichText, RichTextInline } from "@/components/editor/rich-text";
import { richTextToPlain } from "@/components/editor/render";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Vista previa de impresión" };

const INSTRUCTIONS = [
  "Lee cada pregunta cuidadosamente y elige UNA opción.",
  "La hoja de respuestas será entregada por separado por el docente.",
  "Por favor, responde TODAS las preguntas.",
  "Esta prueba brindará información sobre los aprendizajes para mejorar dentro del aula de clase y sirve como insumo para la planeación de clases.",
];

const KEYS = ["A", "B", "C", "D"] as const;

interface CompetencyRow {
  competency: string;
  questions: number[];
}

function buildCompetencyRows(
  sections: { questions: { number: number; competency: string | null }[] }[],
): CompetencyRow[] {
  const map = new Map<string, number[]>();
  for (const section of sections) {
    for (const q of section.questions) {
      const key = q.competency || "Sin especificar";
      const list = map.get(key) ?? [];
      list.push(q.number);
      map.set(key, list);
    }
  }
  return Array.from(map.entries()).map(([competency, questions]) => ({
    competency,
    questions,
  }));
}

export default async function PrintEvaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const actor = await resolvePrintActor(t, { evaluationId: id, kind: "booklet" });

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

  const competencyRows = buildCompetencyRows(evaluation.sections);

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
        {grade ? <p className="cover-grade">Grado {grade}</p> : null}

        {/* ¿Qué competencias evaluamos? — tabla ICFES */}
        {competencyRows.length > 0 && (
          <div className="competencies-section">
            <p className="competencies-title">¿Qué competencias evaluamos?</p>
            <table className="competencies-table">
              <thead>
                <tr>
                  <th>Competencia</th>
                  <th>Preguntas</th>
                  <th>Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {competencyRows.map((row) => (
                  <tr key={row.competency}>
                    <td>{row.competency}</td>
                    <td className="text-center">
                      {row.questions
                        .sort((a, b) => a - b)
                        .map((n, i) => (
                          <span key={n}>
                            {i > 0 && row.questions.length > 3
                              ? i < row.questions.length - 1
                                ? ", "
                                : " y "
                              : i > 0
                                ? ", "
                                : ""}
                            {n}
                          </span>
                        ))}
                    </td>
                    <td className="text-center">{row.questions.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="cover-booklet-number">{bookletLabel}</p>

        <p className="cover-greeting">¡Hola!</p>

        <p className="cover-instructions-title">Instrucciones</p>
        <p className="cover-instructions-intro">
          A continuación encontrarás una serie de preguntas de selección múltiple con única
          respuesta. Lee con atención cada pregunta y responde en la hoja de respuestas.
        </p>
        <ul className="cover-instructions-list">
          {INSTRUCTIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <div className="mark-example">
          <span>Marca así:</span>
          {KEYS.map((k) => (
            <span key={k} className={`omr-bubble ${k === "A" ? "filled" : ""}`}>
              {k}
            </span>
          ))}
        </div>

        <div className="student-fields">
          <div className="student-field">
            <span className="student-field-label">Nombres y apellidos:</span>
            <span className="student-field-line" />
          </div>
          <div className="student-field">
            <span className="student-field-label">Grado:</span>
            <span className="student-field-line" />
          </div>
          <div className="student-field">
            <span className="student-field-label">Fecha:</span>
            <span className="student-field-line" />
          </div>
        </div>

        {/* Línea de doblez al centro */}
        <div className="fold-line" />
      </section>

      {/* ===== Páginas 2+: preguntas ===== */}
      {evaluation.sections.map((section) => {
        const numbers = section.questions.map((q) => q.number);
        const first = numbers[0];
        const last = numbers[numbers.length - 1];
        const hasContext = richTextToPlain(section.content).length > 0;
        return (
          <section key={section.id} className="sheet questions">
            <div className="page-header">
              <span>{institutionName}</span>
              <span>{bookletLabel}</span>
            </div>
            {area ? <p className="subject-title">{area}</p> : null}

            {numbers.length > 0 && (
              <p className="block-lead">
                RESPONDA LAS PREGUNTAS {first} A LA {last}
                {hasContext || section.title ? " DE ACUERDO CON LA SIGUIENTE INFORMACIÓN" : ""}
              </p>
            )}
            {section.title ? <p className="block-text-title">«{section.title}»</p> : null}
            {hasContext ? <RichText value={section.content} className="context-paragraph" /> : null}

            {section.questions.map((q) => (
              <div key={q.id} className="question">
                <p className="question-text">
                  {q.number}. <RichTextInline value={q.text} />
                </p>
                <ul className="question-options">
                  {q.options.map((o) => (
                    <li key={o.key}>
                      {o.key}. <RichTextInline value={o.text} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="fold-line" />
          </section>
        );
      })}
    </div>
  );
}
