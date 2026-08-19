import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { ScanStatusBadge } from "@/components/evaluations/scan-status-badge";
import { getSheetDetailAction } from "../actions";

export const metadata: Metadata = { title: "Detalle de hoja" };

interface Props {
  params: Promise<{ id: string; sheetId: string }>;
}

export default async function SheetDetailPage({ params }: Props) {
  const { id: evaluationId, sheetId } = await params;
  await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  const sheet = await getSheetDetailAction(evaluationId, sheetId);
  if (!sheet) notFound();

  return (
    <>
      <PageHeader
        title={sheet.studentName ?? "Hoja anónima"}
        description={`${sheet.totalCorrect ?? "?"}/${sheet.totalQuestions ?? "?"} correctas`}
      />

      <div className="mb-6 flex items-center gap-2">
        <Link
          href={`/teacher/evaluations/${evaluationId}/results`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Volver a resultados
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Puntaje
          </p>
          <p className="mt-1 text-2xl font-bold">{sheet.score ?? "—"}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Correctas
          </p>
          <p className="mt-1 text-2xl font-bold">{sheet.totalCorrect ?? "—"}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Código
          </p>
          <p className="mt-1 font-mono text-2xl text-sm font-bold">{sheet.studentCode ?? "—"}</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Estado
          </p>
          <p className="mt-1">
            <ScanStatusBadge status={sheet.status} size="lg" />
          </p>
        </div>
      </div>

      {sheet.notes && (
        <div className="bg-card mb-8 rounded-xl border p-4">
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            Notas
          </p>
          <p className="text-sm">{sheet.notes}</p>
        </div>
      )}

      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-3 font-semibold">Respuestas</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs uppercase">
                <th className="pr-4 pb-2 font-medium">N.º</th>
                <th className="pr-4 pb-2 font-medium">Marcó</th>
                <th className="pr-4 pb-2 font-medium">Correcta</th>
                <th className="pr-4 pb-2 font-medium">Resultado</th>
                <th className="pr-4 pb-2 font-medium">Confianza</th>
              </tr>
            </thead>
            <tbody>
              {sheet.answers.map((a) => (
                <tr key={a.questionNumber} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{a.questionNumber}</td>
                  <td className="py-2 pr-4">
                    {a.selectedKey ? (
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
                          a.isCorrect
                            ? "border-green-500 bg-green-50 text-green-700"
                            : a.isAmbiguous
                              ? "border-amber-400 bg-amber-50 text-amber-700"
                              : a.isCorrect === false
                                ? "border-red-400 bg-red-50 text-red-700"
                                : "border-muted-foreground/30 text-muted-foreground"
                        }`}
                      >
                        {a.isAmbiguous ? "?" : a.selectedKey}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-bold">{a.correctAnswer}</td>
                  <td className="py-2 pr-4">
                    {a.isCorrect === true ? (
                      <span className="text-xs font-medium text-green-600">Correcta</span>
                    ) : a.isCorrect === false ? (
                      <span className="text-xs font-medium text-red-600">Incorrecta</span>
                    ) : a.isAmbiguous ? (
                      <span className="text-xs font-medium text-amber-600">Ambigua</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">Sin detectar</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {a.confidence != null ? `${(a.confidence * 100).toFixed(0)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
