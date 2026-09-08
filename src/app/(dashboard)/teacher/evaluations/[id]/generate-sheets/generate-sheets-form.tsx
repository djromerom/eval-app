"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GroupSelector, type GroupData } from "./group-selector";

/**
 * Formulario "Generar hojas de respuestas" — sprint "descargar de una"
 * (sep 2026).
 *
 * Antes era un `<form action={submitAction}>` server-side que redirigía a
 * /print/bulk-answer-sheets/X?students=... y abría el HTML para que el
 * docente pulsara Imprimir manualmente. Ahora hace la descarga directa del
 * PDF server-side (worker Puppeteer) sin pasar por el HTML:
 *
 *   submit → fetch(`/api/evaluations/${id}/pdf?kind=answer-sheets&students=...`)
 *          → worker genera PDF con hojas filtradas por los studentIds
 *          → browser descarga el blob como `${id}-answer-sheets.pdf`
 *
 * El endpoint `/api/evaluations/[id]/pdf` (sep 2026) ya acepta el parámetro
 * `students=<csv>` y lo pasa al worker como `extraQuery`. Sin students, el
 * worker genera hojas para todos los estudiantes activos de la institución
 * (compat con el flujo legacy).
 */
export function GenerateSheetsForm({
  evaluationId,
  groups,
  totalQuestions,
}: {
  evaluationId: string;
  groups: GroupData[];
  totalQuestions: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const checked = form.querySelectorAll<HTMLInputElement>('input[name="studentIds"]:checked');
    const studentIds = Array.from(checked).map((cb) => cb.value);
    if (studentIds.length === 0) {
      setError("Selecciona al menos un estudiante.");
      return;
    }

    setLoading(true);
    try {
      const url =
        `/api/evaluations/${evaluationId}/pdf?kind=answer-sheets` +
        `&students=${encodeURIComponent(studentIds.join(","))}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "No se pudo generar el PDF.");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${evaluationId}-answer-sheets.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-card rounded-xl border p-6">
        <h2 className="mb-4 font-semibold">Seleccionar estudiantes</h2>

        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay estudiantes registrados. El administrador debe importarlos primero.
          </p>
        ) : (
          <GroupSelector groups={groups} />
        )}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "Generando PDF…" : "Generar hojas de respuestas"}
        </Button>
        <p className="text-muted-foreground text-xs">
          {`${totalQuestions} pregunta(s) — se descargará un PDF con las hojas seleccionadas.`}
        </p>
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
