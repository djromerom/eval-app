"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { ParsedQuestion } from "@/modules/question-import/domain/parsed-question";
import { loadDocxSourceAction, loadSourceAction } from "./actions";
import { QUESTIONS_CSV_TEMPLATE } from "@/modules/question-import/infrastructure/csv";
import { ImportReviewForm } from "./review-form";

interface SourceOption {
  id: string;
  title: string;
  subjectName: string;
  totalQuestions: number;
}
interface SectionOption {
  id: string;
  title: string;
}
interface SubjectOption {
  id: string;
  name: string;
}

interface Props {
  targetEvaluationId: string;
  sources: SourceOption[];
  sections: SectionOption[];
  subjects: SubjectOption[];
}

type LoadSource =
  | { kind: "evaluation"; evaluationId: string }
  | { kind: "csv"; content: string }
  | { kind: "docx"; file: File };

/**
 * Wizard de importación. Maneja el paso 1 (elegir origen) y el paso 2
 * (revisar e importar) en un solo componente cliente.
 *
 * Mantener el estado en cliente (en vez de en la URL como en Fase 1) es
 * necesario a partir de Fase 2: el CSV no se puede meter en la query por
 * tamaño, y el DOCX traerá imágenes en base64. El docente pierde el estado
 * si recarga, pero es el mismo contrato que la importación de estudiantes.
 */
export function ImportWizard({ targetEvaluationId, sources, sections, subjects }: Props) {
  const [step, setStep] = useState<
    { kind: "source" } | { kind: "review"; source: LoadSource; cached?: ParsedQuestion[] }
  >({ kind: "source" });
  const [error, setError] = useState<string | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [csvContent, setCsvContent] = useState<string>("");
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadEvaluation(evaluationId: string) {
    setError(null);
    startTransition(async () => {
      const res = await loadSourceAction({ kind: "evaluation", evaluationId });
      if (res.error) {
        setError(res.error);
        return;
      }
      setStep({
        kind: "review",
        source: { kind: "evaluation", evaluationId },
        cached: res.questions,
      });
    });
  }

  function loadCsv() {
    if (!csvContent.trim()) {
      setError("Sube un archivo CSV.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await loadSourceAction({ kind: "csv", content: csvContent });
      if (res.error) {
        setError(res.error);
        return;
      }
      setStep({
        kind: "review",
        source: { kind: "csv", content: csvContent },
        cached: res.questions,
      });
    });
  }

  function loadDocx() {
    if (!docxFile) {
      setError("Sube un archivo DOCX.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", docxFile);
      const res = await loadDocxSourceAction(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setStep({
        kind: "review",
        source: { kind: "docx", file: docxFile },
        cached: res.questions,
      });
    });
  }

  if (step.kind === "review") {
    return (
      <ImportReviewForm
        targetEvaluationId={targetEvaluationId}
        sections={sections}
        subjects={subjects}
        source={step.source}
        initialQuestions={step.cached}
        onBack={() => {
          setStep({ kind: "source" });
          setError(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-card space-y-3 rounded-xl border p-6">
        <h2 className="font-semibold">Copiar de otra evaluación</h2>
        {sources.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No tienes otras evaluaciones con preguntas.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Se copiarán sus preguntas. Podrás revisar y descartar antes de confirmar.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <select
                id="source-eval"
                className="border-input bg-background focus-visible:ring-ring h-9 max-w-md flex-1 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                defaultValue={sources[0]?.id ?? ""}
              >
                {sources.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {e.subjectName} · {e.totalQuestions} pregunta(s)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  const sel = document.getElementById("source-eval") as HTMLSelectElement | null;
                  if (sel?.value) loadEvaluation(sel.value);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50"
              >
                Usar esta evaluación →
              </button>
            </div>
          </>
        )}
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Subir CSV</h2>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(QUESTIONS_CSV_TEMPLATE)}`}
            download="plantilla-preguntas.csv"
            className="text-muted-foreground text-xs hover:underline"
          >
            Descargar plantilla
          </a>
        </div>
        <p className="text-muted-foreground text-sm">
          Columnas: enunciado, a–h, correcta (A–H), competencia, evidencia, contexto.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={isPending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setCsvFileName(file.name);
              setCsvContent(await file.text());
            }}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
          />
          <button
            type="button"
            disabled={isPending || !csvContent}
            onClick={loadCsv}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? "Procesando…" : `Procesar ${csvFileName || "CSV"} →`}
          </button>
        </div>
      </section>

      <section className="bg-card space-y-3 rounded-xl border p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Subir DOCX</h2>
          <a
            href="/templates/plantilla-preguntas.docx"
            download="plantilla-preguntas.docx"
            className="text-muted-foreground text-xs hover:underline"
          >
            Descargar plantilla
          </a>
        </div>
        <p className="text-muted-foreground text-sm">
          Tu examen en Word. Si trae una tabla con{" "}
          <code>Item | Clave | Competencia | Evidencia</code> al final, recuperamos la respuesta
          correcta y los metadatos; si no, la marcamos manualmente en la revisión. Las imágenes
          inline se suben a la carpeta del colegio.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setDocxFile(file);
            }}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm shadow-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
          />
          <button
            type="button"
            disabled={isPending || !docxFile}
            onClick={loadDocx}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? "Procesando…" : `Procesar ${docxFile?.name ?? "DOCX"} →`}
          </button>
        </div>
      </section>

      {error ? (
        <p className="text-destructive border-destructive/40 rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs">
        <Link href={`/teacher/evaluations/${targetEvaluationId}`} className="hover:underline">
          ← Volver a la evaluación
        </Link>
      </p>
    </div>
  );
}
