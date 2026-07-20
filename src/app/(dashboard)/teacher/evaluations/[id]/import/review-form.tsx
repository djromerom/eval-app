"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type { ParsedQuestion } from "@/modules/question-import/domain/parsed-question";
import { commitImportAction, loadSourceAction } from "./actions";

const controlClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none";

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
  sections: SectionOption[];
  subjects: SubjectOption[];
  sourceEvaluationId: string;
}

/**
 * Wizard de revisión de la importación.
 *
 * Carga las preguntas con `loadSourceAction` (origen "otra evaluación" en
 * Fase 1), deja que el docente descarte y corrija la respuesta correcta
 * cuando falte, y al confirmar envía todo el array al server action
 * `commitImportAction`. El estado NO se persiste: vive en React hasta el
 * submit, igual que la importación de estudiantes.
 */
export function ImportReviewForm({
  targetEvaluationId,
  sections,
  subjects,
  sourceEvaluationId,
}: Props) {
  const [questions, setQuestions] = useState<ParsedQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // El docente puede destildar preguntas y, si falta la correcta, marcarla.
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [corrections, setCorrections] = useState<Record<number, AnswerKey>>({});
  const [destinationKind, setDestinationKind] = useState<"evaluation" | "bank">("evaluation");
  const [destinationId, setDestinationId] = useState<string>(sections[0]?.id ?? "");

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    { imported: number; problems: { index: number; message: string }[] } | { error: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    loadSourceAction(sourceEvaluationId).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      setQuestions(res.questions);
      // Por defecto todas seleccionadas.
      setIncluded(new Set(res.questions.map((_, idx) => idx)));
    });
    return () => {
      cancelled = true;
    };
  }, [sourceEvaluationId]);

  const payload = useMemo(() => questions ?? [], [questions]);

  const importableCount = useMemo(() => {
    return payload.filter(
      (q, idx) => included.has(idx) && (q.correctAnswer !== null || corrections[idx] !== undefined),
    ).length;
  }, [payload, included, corrections]);

  if (loadError) {
    return (
      <p className="text-destructive rounded-lg border border-dashed p-6 text-sm">{loadError}</p>
    );
  }

  if (questions === null) {
    return <p className="text-muted-foreground text-sm">Cargando preguntas…</p>;
  }

  if (questions.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
        La evaluación origen no tiene preguntas.
      </p>
    );
  }

  if (result && "imported" in result) {
    return (
      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="text-primary font-semibold">Importación completada</h2>
        <p className="text-sm">
          Se importaron <strong>{result.imported}</strong> pregunta(s).
        </p>
        {result.problems.length > 0 ? (
          <div className="bg-muted/40 space-y-1 rounded-md p-3 text-sm">
            <p className="font-medium">No se pudieron importar:</p>
            <ul className="list-disc pl-5">
              {result.problems.map((p) => (
                <li key={p.index}>
                  Pregunta #{p.index + 1}: {p.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex gap-3">
          <Link
            href={`/teacher/evaluations/${targetEvaluationId}`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium"
          >
            Volver a la evaluación
          </Link>
        </div>
      </section>
    );
  }

  return (
    <form
      action={(fd) => {
        startTransition(async () => {
          const res = await commitImportAction(null, fd);
          if (res.error) setResult({ error: res.error });
          else if (res.imported !== undefined)
            setResult({
              imported: res.imported,
              problems: (res.problems ?? []).map((p) => ({
                index: p.index,
                message: p.message,
              })),
            });
        });
      }}
      className="space-y-6"
    >
      <input type="hidden" name="evaluationId" value={targetEvaluationId} />
      <input
        type="hidden"
        name="payload"
        value={JSON.stringify(payload.map((q, idx) => ({ ...q, _idx: idx })))}
      />
      <input type="hidden" name="corrections" value={JSON.stringify(corrections)} />
      <input type="hidden" name="destinationKind" value={destinationKind} />
      {destinationKind === "evaluation" ? (
        <input type="hidden" name="sectionId" value={destinationId} />
      ) : null}

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="font-semibold">Destino</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="destinationKindRadio"
              value="evaluation"
              checked={destinationKind === "evaluation"}
              onChange={() => {
                setDestinationKind("evaluation");
                setDestinationId(sections[0]?.id ?? "");
              }}
            />
            Añadir a esta evaluación
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="destinationKindRadio"
              value="bank"
              checked={destinationKind === "bank"}
              onChange={() => {
                setDestinationKind("bank");
                setDestinationId(subjects[0]?.id ?? "");
              }}
            />
            Guardar en el banco
          </label>
          {destinationKind === "evaluation" ? (
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">Contexto</label>
              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className={controlClass}
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">Asignatura</label>
              <select
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                className={controlClass}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      <section className="bg-card space-y-4 rounded-xl border p-6">
        <h2 className="font-semibold">
          Preguntas a importar{" "}
          <span className="text-muted-foreground text-sm font-normal">
            ({importableCount} de {payload.length} listas)
          </span>
        </h2>

        <ul className="space-y-3">
          {payload.map((q, idx) => {
            const checked = included.has(idx);
            const isImportable = q.correctAnswer !== null || corrections[idx] !== undefined;
            const contextBlock =
              q.contextText && q.contextTitle ? (
                <details className="text-muted-foreground ml-7 text-xs">
                  <summary className="cursor-pointer">{q.contextTitle}</summary>
                  <div className="mt-1 whitespace-pre-wrap">{q.contextText}</div>
                </details>
              ) : null;

            return (
              <li key={idx} className="rounded-lg border p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="include"
                    value={idx}
                    checked={checked}
                    onChange={(e) => {
                      setIncluded((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(idx);
                        else next.delete(idx);
                        return next;
                      });
                    }}
                    className="mt-1"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="text-muted-foreground text-xs">
                      {q.sourceNumber !== null ? `Pregunta ${q.sourceNumber}` : "Sin número"} ·{" "}
                      {q.options.length} opción(es)
                      {q.warnings.length > 0 ? (
                        <span className="text-destructive ml-2">⚠ {q.warnings.join(" · ")}</span>
                      ) : null}
                    </div>
                    <p className="font-medium">{q.text}</p>
                    <ul className="space-y-1 text-sm">
                      {q.options.map((o) => (
                        <li
                          key={o.key}
                          className={o.key === q.correctAnswer ? "text-primary font-medium" : ""}
                        >
                          {o.key}) {o.text}
                          {o.key === q.correctAnswer ? " ✓" : ""}
                        </li>
                      ))}
                    </ul>
                    {q.competency || q.evidence ? (
                      <p className="text-muted-foreground text-xs">
                        {q.competency ? `Competencia: ${q.competency}` : ""}
                        {q.evidence ? ` · Evidencia: ${q.evidence}` : ""}
                      </p>
                    ) : null}
                    {contextBlock}

                    {!q.correctAnswer && checked ? (
                      <div className="bg-muted/40 mt-2 space-y-1 rounded-md p-2">
                        <p className="text-muted-foreground text-xs">
                          El origen no indicaba la respuesta correcta. Márcala para poder importar:
                        </p>
                        <select
                          value={corrections[idx] ?? ""}
                          onChange={(e) =>
                            setCorrections((prev) => ({
                              ...prev,
                              [idx]: e.target.value as AnswerKey,
                            }))
                          }
                          className={controlClass}
                        >
                          <option value="">— elige —</option>
                          {q.options.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.key}) {o.text}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {!isImportable && checked ? (
                      <p className="text-destructive mt-1 text-xs">
                        Marca la respuesta correcta para poder importar esta pregunta.
                      </p>
                    ) : null}
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {result && "error" in result ? (
        <p className="text-destructive border-destructive/40 rounded-lg border p-3 text-sm">
          {result.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || importableCount === 0}
          className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? "Importando…" : `Importar ${importableCount} pregunta(s)`}
        </button>
        <Link
          href={`/teacher/evaluations/${targetEvaluationId}/import`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Cambiar origen
        </Link>
      </div>
    </form>
  );
}
