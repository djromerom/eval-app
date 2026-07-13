import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/answer-sheet.css";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { PrintButton } from "../../evaluation/[id]/print-button";

export const metadata: Metadata = { title: "Clave de respuestas" };

interface Props {
  params: Promise<{ evaluationId: string }>;
}

export default async function AnswerKeyPage({ params }: Props) {
  const { evaluationId } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const evalRes = await makeGetEvaluation().execute({ actor, id: evaluationId });
  if (!evalRes.ok) notFound();

  const evaluation = evalRes.value;
  const allQuestions = evaluation.sections.flatMap((s) => s.questions);

  return (
    <div className="booklet">
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">Clave de respuestas — {evaluation.title}</span>
        <PrintButton />
      </div>

      <section className="sheet" style={{ padding: "2rem", maxWidth: "600px" }}>
        <h1 style={{ fontSize: "14pt", fontWeight: 700, marginBottom: "0.5rem" }}>
          Clave de respuestas
        </h1>
        <p style={{ fontSize: "11pt", marginBottom: "1rem" }}>{evaluation.title}</p>

        {allQuestions.length === 0 ? (
          <p className="text-muted-foreground">Esta evaluación no tiene preguntas.</p>
        ) : (
          <table
            className="key-table"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #000" }}>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "left" }}>N.º</th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "left" }}>Respuesta</th>
                <th style={{ padding: "0.4rem 0.5rem", textAlign: "left" }}>
                  Justificación / clave
                </th>
              </tr>
            </thead>
            <tbody>
              {allQuestions.map((q) => (
                <tr key={q.id} style={{ borderBottom: "1px solid #ccc" }}>
                  <td style={{ padding: "0.4rem 0.5rem", fontWeight: 700 }}>{q.number}</td>
                  <td style={{ padding: "0.4rem 0.5rem" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "1.5rem",
                        height: "1.5rem",
                        border: "1px solid #000",
                        borderRadius: "50%",
                        fontSize: "9pt",
                        fontWeight: 700,
                      }}
                    >
                      {q.correctAnswer}
                    </span>
                  </td>
                  <td style={{ padding: "0.4rem 0.5rem", color: "#555" }}>
                    {q.justification ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ marginTop: "1.5rem", fontSize: "9pt", color: "#888", fontStyle: "italic" }}>
          Esta clave es para uso exclusivo del docente. No distribuir a estudiantes.
        </p>
      </section>
    </div>
  );
}
