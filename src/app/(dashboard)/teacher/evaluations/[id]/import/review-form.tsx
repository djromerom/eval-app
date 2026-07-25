"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type { ParsedQuestion } from "@/modules/question-import/domain/parsed-question";
import { contextTextToTipTap } from "@/modules/question-import/application/context-to-tiptap";
import { RichText } from "@/components/editor/rich-text";
import { commitImportAction, loadSourceAction } from "./actions";
import { ConfidenceBadge } from "./confidence-badge";

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
  /** Origen del que se sacan las preguntas. */
  source:
    | { kind: "evaluation"; evaluationId: string }
    | { kind: "csv"; content: string }
    | { kind: "docx"; file: File }
    | { kind: "ai"; fileName: string };
  /** Si el padre ya cargó las preguntas (caso normal), se evita el re-fetch. */
  initialQuestions?: ParsedQuestion[];
  /** Volver al paso 1 para cambiar de origen. */
  onBack?: () => void;
}

/**
 * Wizard de revisión de la importación.
 *
 * Carga las preguntas con `loadSourceAction` (origen "otra formulación" en
 * Fase 1, "CSV" en Fase 2), deja que el docente descarte y corrija la
 * respuesta correcta cuando falte, y al confirmar envía todo el array al
 * server action `commitImportAction`. El estado NO se persiste: vive en
 * React hasta el submit, igual que la importación de estudiantes.
 */
export function ImportReviewForm({
  targetEvaluationId,
  sections,
  subjects,
  source,
  initialQuestions,
  onBack,
}: Props) {
  const [questions, setQuestions] = useState<ParsedQuestion[] | null>(initialQuestions ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // El docente puede destildar preguntas y, si falta la correcta, marcarla.
  // Las preguntas con `answerConfidence === "baja"` arrancan DESTILDADAS: la
  // IA marcó la respuesta correcta con poca seguridad, así que obligamos
  // al docente a confirmar que quiere importarla antes de que cuente para
  // el alta.
  const [included, setIncluded] = useState<Set<number>>(() => {
    const initial = initialQuestions ?? [];
    const set = new Set<number>();
    initial.forEach((q, idx) => {
      if (q.answerConfidence !== "baja") set.add(idx);
    });
    return set;
  });
  const [corrections, setCorrections] = useState<Record<number, AnswerKey>>({});
  const [destinationKind, setDestinationKind] = useState<"evaluation" | "bank">("evaluation");
  const [destinationId, setDestinationId] = useState<string>(sections[0]?.id ?? "");

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { imported: number; problems: { index: number; message: string }[]; infos: string[] }
    | { error: string }
    | null
  >(null);

  useEffect(() => {
    // Si el padre ya pasó las preguntas, no hay que volver a pedirlas.
    // El DOCX no se vuelve a pedir: el padre lo subió vía multipart y solo
    // guarda la referencia al File original.
    if (initialQuestions || source.kind === "docx" || source.kind === "ai") return;
    let cancelled = false;
    const req =
      source.kind === "evaluation"
        ? { kind: "evaluation" as const, evaluationId: source.evaluationId }
        : { kind: "csv" as const, content: source.content };
    loadSourceAction(req).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setLoadError(res.error);
        return;
      }
      setQuestions(res.questions);
      // Por defecto todas seleccionadas, EXCEPTO las de confianza "baja":
      // las obligamos a confirmación manual (ver useState arriba).
      setIncluded(
        new Set(
          res.questions
            .map((q, idx) => (q.answerConfidence === "baja" ? -1 : idx))
            .filter((i) => i >= 0),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [source, initialQuestions]);

  const payload = useMemo(() => questions ?? [], [questions]);

  const hasContexts = useMemo(() => payload.some((q) => q.contextText?.trim()), [payload]);

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
        La formulación origen no tiene preguntas.
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
        {(result.infos?.length ?? 0) > 0 ? (
          <div className="bg-muted/40 space-y-1 rounded-md p-3 text-sm">
            <p className="font-medium">Notas de la importación:</p>
            <ul className="list-disc pl-5">
              {(result.infos ?? []).map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex gap-3">
          <Link
            href={`/teacher/evaluations/${targetEvaluationId}/contexts`}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium"
          >
            Volver a la formulación
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
              infos: res.infos ?? [],
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
      {destinationKind === "evaluation" && !hasContexts ? (
        <input type="hidden" name="destinationId" value={destinationId} />
      ) : null}
      {destinationKind === "evaluation" && !hasContexts ? (
        <input type="hidden" name="sectionId" value={destinationId} />
      ) : null}
      {destinationKind === "bank" ? (
        <input type="hidden" name="destinationId" value={destinationId} />
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
            Añadir a esta formulación
            {hasContexts ? (
              <span className="text-muted-foreground ml-1 text-xs">
                (se crearán secciones por cada contexto del documento)
              </span>
            ) : null}
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
          {destinationKind === "evaluation" && !hasContexts ? (
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
          ) : null}
          {destinationKind === "bank" ? (
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
          ) : null}
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
                  <div className="mt-1">
                    <RichText
                      value={{ type: "doc", content: contextTextToTipTap(q.contextText) }}
                    />
                  </div>
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
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span>
                        {q.sourceNumber !== null ? `Pregunta ${q.sourceNumber}` : "Sin número"} ·{" "}
                        {q.options.length} opción(es)
                      </span>
                      {q.answerConfidence ? (
                        <ConfidenceBadge level={q.answerConfidence} rationale={q.answerRationale} />
                      ) : null}
                      {q.warnings.length > 0 ? (
                        <span className="text-destructive">⚠ {q.warnings.join(" · ")}</span>
                      ) : null}
                    </div>
                    {q.answerConfidence === "baja" && checked ? (
                      <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950 dark:text-rose-100">
                        Confianza baja: revisa la respuesta marcada por la IA antes de importar.
                      </p>
                    ) : null}
                    {q.image ? (
                      <img
                        src={q.image.url}
                        alt=""
                        className="max-h-32 rounded border bg-white object-contain"
                      />
                    ) : null}
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
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Cambiar origen
          </button>
        ) : (
          <Link
            href={`/teacher/evaluations/${targetEvaluationId}/import`}
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Cambiar origen
          </Link>
        )}
      </div>
    </form>
  );
}
