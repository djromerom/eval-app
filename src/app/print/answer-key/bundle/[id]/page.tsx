import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/answer-sheet.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { PrintButton } from "../../../evaluation/[id]/print-button";

export const metadata: Metadata = { title: "Clave de respuestas del compendio" };

interface BundleKeyRow {
  globalNumber: number;
  localNumber: number;
  correctAnswer: string;
  justification: string | null;
  evaluationTitle: string;
  sectionTitle: string | null;
}

interface BundleKeySection {
  evaluationTitle: string;
  evaluationId: string;
  sectionTitle: string | null;
  rows: BundleKeyRow[];
}

/**
 * Render server-side de la clave de respuestas UNIFICADA del compendio.
 * Numeración global continua; cada fila = (pregunta, respuesta correcta,
 * justificación). El worker de Puppeteer abre esta ruta con un token
 * firmado (kind = "answer-key-bundle"). Sprint 3.
 */
export default async function BundleAnswerKeyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;

  const actor = await resolvePrintActor(t, { bundleId: id, kind: "answer-key-bundle" });

  const [bundleRes, instRes] = await Promise.all([
    makeGetBundle().execute({ actor, bundleId: id }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!bundleRes.ok) notFound();

  const bundle = bundleRes.value;
  const institutionName = instRes.ok ? instRes.value.name : "";

  // Cargar questions + sections de cada evaluation del bundle en orden.
  const sections: BundleKeySection[] = [];
  let globalCounter = 1;
  for (const item of bundle.items) {
    const evaluation = await prisma.evaluation.findUnique({
      where: { id: item.evaluationId },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: {
            questions: {
              orderBy: { number: "asc" },
              include: { options: true },
            },
          },
        },
      },
    });
    if (!evaluation) continue;
    for (const section of evaluation.sections) {
      const rows: BundleKeyRow[] = section.questions.map((q) => ({
        globalNumber: globalCounter++,
        localNumber: q.number,
        correctAnswer: q.correctAnswer,
        justification: q.justification ?? null,
        evaluationTitle: evaluation.title,
        sectionTitle: section.title,
      }));
      sections.push({
        evaluationTitle: evaluation.title,
        evaluationId: evaluation.id,
        sectionTitle: section.title,
        rows,
      });
    }
  }

  return (
    <div className="booklet">
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          Clave de respuestas del compendio &laquo;{bundle.name}&raquo;
        </span>
        <PrintButton />
      </div>

      <section className="sheet" style={{ padding: "2rem", maxWidth: "700px" }}>
        <h1 style={{ fontSize: "14pt", fontWeight: 700, marginBottom: "0.3rem" }}>
          Clave de respuestas — Compendio
        </h1>
        <p style={{ fontSize: "11pt", marginBottom: "0.2rem" }}>{bundle.name}</p>
        <p style={{ fontSize: "9pt", color: "#666", marginBottom: "1rem" }}>
          {institutionName} · {bundle.bookletNumber ? `Cuadernillo ${bundle.bookletNumber}` : ""}
        </p>

        {sections.flatMap((s) => s.rows).length === 0 ? (
          <p className="text-muted-foreground">Este compendio no tiene preguntas.</p>
        ) : (
          <table
            className="key-table"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "9pt" }}
          >
            <thead>
              <tr style={{ borderBottom: "2px solid #000" }}>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "left", width: "3rem" }}>N.º</th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "left", width: "3rem" }}>
                  Local
                </th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "left", width: "2rem" }}>
                  Resp.
                </th>
                <th style={{ padding: "0.3rem 0.4rem", textAlign: "left" }}>Justificación</th>
              </tr>
            </thead>
            <tbody>
              {sections.flatMap((section) =>
                section.rows.map((r) => (
                  <tr
                    key={`${section.evaluationId}-${r.globalNumber}`}
                    style={{ borderBottom: "1px solid #ddd" }}
                  >
                    <td style={{ padding: "0.3rem 0.4rem", fontWeight: 700 }}>{r.globalNumber}</td>
                    <td style={{ padding: "0.3rem 0.4rem", color: "#888" }}>{r.localNumber}</td>
                    <td style={{ padding: "0.3rem 0.4rem" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "1.3rem",
                          height: "1.3rem",
                          border: "1px solid #000",
                          borderRadius: "50%",
                          fontSize: "8pt",
                          fontWeight: 700,
                        }}
                      >
                        {r.correctAnswer}
                      </span>
                    </td>
                    <td style={{ padding: "0.3rem 0.4rem", color: "#555" }}>
                      {r.justification ?? "—"}
                    </td>
                  </tr>
                )),
              )}
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
