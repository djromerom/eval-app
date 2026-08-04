import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { getEvaluationResultsAction } from "./actions";

export const metadata: Metadata = { title: "Resultados" };

interface Props {
  params: Promise<{ id: string }>;
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  const hue = pct >= 70 ? 142 : pct >= 40 ? 38 : 0;
  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: `hsl(${hue}, 70%, 45%)` }}
      />
    </div>
  );
}

export default async function ResultsPage({ params }: Props) {
  const { id } = await params;
  await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const results = await getEvaluationResultsAction(id);
  if (!results) notFound();

  return (
    <>
      <PageHeader
        title="Resultados"
        description={`${results.totalSheets} hoja(s) · ${results.gradedSheets} calificada(s)`}
      />

      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/teacher/evaluations/${id}/contexts`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Volver a la formulación
        </Link>
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Promedio"
          value={results.averageScore != null ? results.averageScore.toFixed(1) : "—"}
          accent
        />
        <StatCard label="Mínimo" value={results.minScore ?? "—"} />
        <StatCard label="Máximo" value={results.maxScore ?? "—"} />
        <StatCard label="Calificadas" value={`${results.gradedSheets}/${results.totalSheets}`} />
      </div>

      {/* Score distribution */}
      <section className="bg-card mb-8 rounded-xl border p-5 shadow-sm">
        <h3 className="font-display mb-4 text-lg font-semibold">Distribución de puntajes</h3>
        {results.scoreDistribution.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin datos.</p>
        ) : (
          <div className="space-y-2">
            {results.scoreDistribution.map((b) => {
              const maxCount = Math.max(...results.scoreDistribution.map((x) => x.count), 1);
              return (
                <div key={b.range} className="flex items-center gap-3 text-sm">
                  <span className="w-16 text-right font-mono text-xs">{b.range}</span>
                  <div className="bg-muted h-5 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${(b.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-6 text-right font-mono text-xs">
                    {b.count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Per-question stats */}
      <section className="bg-card mb-8 rounded-xl border p-5 shadow-sm">
        <h3 className="font-display mb-4 text-lg font-semibold">Análisis por pregunta</h3>
        {results.questionStats.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin datos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs uppercase">
                  <th className="pr-3 pb-2 font-medium">N.º</th>
                  <th className="pr-3 pb-2 font-medium">Total</th>
                  <th className="pr-3 pb-2 font-medium text-green-600">Correctas</th>
                  <th className="pr-3 pb-2 font-medium text-red-600">Incorrectas</th>
                  <th className="pr-3 pb-2 font-medium text-amber-600">Ambiguas</th>
                  <th className="pr-3 pb-2 font-medium">Sin respuesta</th>
                  <th className="pr-3 pb-2 font-medium">Acierto</th>
                  <th className="pb-2 font-medium">Barra</th>
                </tr>
              </thead>
              <tbody>
                {results.questionStats.map((q) => (
                  <tr key={q.number} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{q.number}</td>
                    <td className="py-2 pr-3">{q.total}</td>
                    <td className="py-2 pr-3 text-green-600">{q.correct}</td>
                    <td className="py-2 pr-3 text-red-600">{q.incorrect}</td>
                    <td className="py-2 pr-3 text-amber-600">{q.ambiguous}</td>
                    <td className="py-2 pr-3">{q.unanswered}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {q.accuracy != null ? `${(q.accuracy * 100).toFixed(0)}%` : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(q.accuracy ?? 0) * 100}%`,
                            backgroundColor:
                              (q.accuracy ?? 0) >= 0.7
                                ? "hsl(142, 70%, 45%)"
                                : (q.accuracy ?? 0) >= 0.4
                                  ? "hsl(38, 70%, 45%)"
                                  : "hsl(0, 70%, 45%)",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sheets list */}
      <section className="bg-card rounded-xl border p-5 shadow-sm">
        <h3 className="font-display mb-4 text-lg font-semibold">Hojas de respuestas</h3>
        {results.sheets.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay hojas escaneadas para esta formulación.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs uppercase">
                  <th className="pr-3 pb-2 font-medium">Estudiante</th>
                  <th className="pr-3 pb-2 font-medium">Código</th>
                  <th className="pr-3 pb-2 font-medium">Estado</th>
                  <th className="pr-3 pb-2 font-medium">Puntaje</th>
                  <th className="pr-3 pb-2 font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {results.sheets.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{s.studentName ?? "—"}</td>
                    <td className="text-muted-foreground py-2 pr-3 font-mono text-xs">
                      {s.studentCode ?? "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <ScanStatusBadge status={s.status} />
                    </td>
                    <td className="py-2 pr-3">
                      {s.score != null ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {s.totalCorrect}/{s.totalQuestions}
                          </span>
                          <div className="w-16">
                            <ScoreBar score={s.totalCorrect ?? 0} max={s.totalQuestions ?? 1} />
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/teacher/evaluations/${id}/results/${s.id}`}
                        className="text-primary text-xs font-medium hover:underline"
                      >
                        Ver detalle →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
