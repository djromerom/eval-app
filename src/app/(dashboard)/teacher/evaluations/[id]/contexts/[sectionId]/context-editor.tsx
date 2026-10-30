"use client";

import { useState } from "react";
import Link from "next/link";
import { Image as ImageIcon, Plus, Sparkles } from "lucide-react";
import type { SoloLevel } from "@/modules/evaluations/domain/evaluation";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/editor/rich-text";
import { SectionEditor } from "../../../section-editor";
import { QuestionEditor, type QuestionHeaderData } from "../../../question-editor";
import { QuestionForm, type QuestionInitialValues } from "../../../question-form";
import { importBankQuestionAction } from "../../../../question-bank/actions";
import { renderTipTap } from "./rich-text-flat";
import { SortableQuestionList } from "./sortable-question-list";

/** Forma mínima que necesitamos pintar una pregunta en modo lectura. */
interface QuestionLite {
  id: string;
  number: number;
  text: unknown;
  options: { key: string; text: unknown }[];
  correctAnswer: string;
  justification: string | null;
  weight: number;
  soloLevel: SoloLevel | null;
  menComponent: string | null;
  competency: string | null;
}

interface SectionLite {
  id: string;
  order: number;
  title: string | null;
  content: unknown;
  snippet: string;
  /** Override del layout de impresión (`null` = auto / heurística). */
  columnLayoutOverride: string | null;
  questions: QuestionLite[];
}

interface BankQuestionLite {
  id: string;
  text: string;
}

export interface ContextEditorData {
  evaluationId: string;
  evaluationTitle: string;
  evaluationStatus: EvaluationStatus;
  section: SectionLite;
  editable: boolean;
  bankQuestions: BankQuestionLite[];
  /**
   * Rango de opciones de respuesta. Se leen en el server page desde
   * `env.EVAL_DEFAULT_OPTIONS` / `env.EVAL_MAX_OPTIONS` y se pasan como
   * números planos para no importar `@/config/env` desde un componente
   * cliente (eso arrastraría la validación de secretos al bundle del
   * navegador).
   */
  defaultOptions: number;
  /** Mínimo de opciones permitido por la regla de (Prueba × Asignatura). */
  minOptions: number;
  maxOptions: number;
}

/**
 * Componente cliente que pinta una sola sección enfocada.
 *
 * Estructura (matches Pencil "Editor por contexto"):
 *  1. Banner de contexto: thumbnail + título + Snippet del `content` + CTA
 *     `Editar contexto` (toggle del `SectionEditor` reusado) + link al índice.
 *  2. Header de la lista: count + `Sugerir pregunta` (placeholder, Fase 8) +
 *     `+ Añadir pregunta`.
 *  3. Lista de preguntas: `QuestionEditor` reusado (modo lectura = bloque
 *     derivado del padre).
 *  4. Panel Banco lateral: bankQuestions + hint contextual.
 */
export function ContextEditor({ data }: { data: ContextEditorData }) {
  const [showNewQuestionForm, setShowNewQuestionForm] = useState(false);
  const [showSuggestTooltip, setShowSuggestTooltip] = useState(false);

  const heading = data.section.title ?? `Contexto ${data.section.order + 1}`;
  const indexHref = `/teacher/evaluations/${data.evaluationId}/contexts`;
  const competencies = Array.from(
    new Set(data.section.questions.map((q) => q.competency).filter(Boolean)),
  ) as string[];

  // Pre-asignamos el questionNumber = siguiente al último (si hay), sino 1.
  // El form lo usa para numerar y el server action lo renumera en cascada.
  const nextQuestionNumber =
    data.section.questions.length > 0
      ? Math.max(...data.section.questions.map((q) => q.number)) + 1
      : 1;

  return (
    <div className="space-y-6">
      {/* 1. Banner del contexto */}
      <section
        aria-label="Resumen del contexto"
        className="bg-brand-mint-tint border-accent flex flex-wrap items-start gap-4 rounded-xl border p-5"
      >
        <span
          aria-hidden
          className="bg-primary flex h-14 w-14 shrink-0 items-center justify-center rounded-lg"
        >
          <ImageIcon className="text-primary-foreground h-7 w-7" />
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-accent-foreground text-xs font-bold tracking-wider uppercase">
            Contexto Común
          </p>
          <RichText value={data.section.content} className="text-foreground text-sm" />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {data.editable ? (
            <SectionEditor
              evaluationId={data.evaluationId}
              sectionId={data.section.id}
              heading={heading}
              title={data.section.title}
              content={data.section.content}
              questionCount={data.section.questions.length}
              columnLayoutOverride={data.section.columnLayoutOverride}
            />
          ) : null}
          <Link href={indexHref} className="text-primary text-xs font-semibold hover:underline">
            ← Ver todos los contextos
          </Link>
        </div>
      </section>

      {/* 2 + 3 + 4: layout de 2 columnas (lista + banco) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section aria-label="Enunciados del contexto" className="space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold">Enunciados del contexto</h2>
              <p className="text-muted-foreground text-xs">
                {data.section.questions.length} pregunta
                {data.section.questions.length === 1 ? "" : "s"} · pulsa una pregunta para editarla
                o eliminarla
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  onMouseEnter={() => setShowSuggestTooltip(true)}
                  onMouseLeave={() => setShowSuggestTooltip(false)}
                  onFocus={() => setShowSuggestTooltip(true)}
                  onBlur={() => setShowSuggestTooltip(false)}
                  className="border-accent text-accent-foreground bg-brand-mint-tint"
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" /> Sugerir pregunta
                </Button>
                {showSuggestTooltip ? (
                  <span
                    role="tooltip"
                    className="bg-foreground text-background absolute top-full right-0 z-10 mt-1 w-56 rounded-md px-2 py-1 text-xs shadow-md"
                  >
                    Próximamente — Fase 8 (Sugerencias IA por contexto)
                  </span>
                ) : null}
              </div>
              {data.editable ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowNewQuestionForm((v) => !v)}
                  variant={showNewQuestionForm ? "ghost" : "default"}
                >
                  {showNewQuestionForm ? (
                    "Cerrar"
                  ) : (
                    <>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Añadir pregunta
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </header>

          {showNewQuestionForm && data.editable ? (
            <div className="bg-card space-y-3 rounded-xl border p-4">
              <header className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="bg-primary text-primary-foreground flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                >
                  {nextQuestionNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-semibold">Nueva pregunta</p>
                  <p className="text-muted-foreground text-[11px]">
                    Se numerará como <strong>p{nextQuestionNumber}</strong> del contexto y aparecerá
                    abajo en la lista.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowNewQuestionForm(false)}
                >
                  Cancelar
                </Button>
              </header>
              <QuestionForm
                evaluationId={data.evaluationId}
                sectionId={data.section.id}
                defaultOptions={data.defaultOptions}
                minOptions={data.minOptions}
                maxOptions={data.maxOptions}
              />
            </div>
          ) : null}

          {data.section.questions.length === 0 ? (
            <p className="bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
              Este contexto aún no tiene preguntas. Usa &quot;Añadir pregunta&quot; o importa desde
              el banco.
            </p>
          ) : (
            <SortableQuestionList
              evaluationId={data.evaluationId}
              sectionId={data.section.id}
              questionIds={data.section.questions.map((q) => q.id)}
              editable={data.editable}
              renderItem={(id: string) => {
                const q = data.section.questions.find((qq) => qq.id === id);
                if (!q) return null;
                const initial: QuestionInitialValues = {
                  id: q.id,
                  text: q.text,
                  options: q.options as { key: string; text: unknown }[],
                  correctAnswer: q.correctAnswer,
                  justification: q.justification,
                  weight: q.weight,
                  soloLevel: q.soloLevel,
                  menComponent: q.menComponent,
                  competency: q.competency,
                };
                const header: QuestionHeaderData = {
                  id: q.id,
                  number: q.number,
                  competency: q.competency,
                };
                return (
                  <QuestionEditor
                    evaluationId={data.evaluationId}
                    sectionId={data.section.id}
                    questionNumber={q.number}
                    initial={initial}
                    defaultOptions={data.defaultOptions}
                    minOptions={data.minOptions}
                    maxOptions={data.maxOptions}
                    header={header}
                  >
                    <QuestionReadView q={q} />
                  </QuestionEditor>
                );
              }}
            />
          )}
        </section>

        {/* 4. Panel Banco lateral */}
        <aside aria-label="Banco de preguntas" className="space-y-3">
          <div className="bg-card rounded-xl border p-4">
            <h3 className="font-display text-sm font-semibold">
              Banco · {data.bankQuestions.length} disponibles
            </h3>
            {competencies.length > 0 ? (
              <p className="text-muted-foreground mt-2 text-xs leading-snug">
                <strong>Sugeridas para este contexto:</strong> {competencies.join(" · ")}
              </p>
            ) : (
              <p className="text-muted-foreground mt-2 text-xs italic">
                Marca la competencia en tus preguntas para ver sugerencias aquí.
              </p>
            )}
          </div>

          {data.bankQuestions.length === 0 ? (
            <p className="bg-card text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
              No hay preguntas en el banco para esta asignatura.
            </p>
          ) : (
            <div className="bg-card space-y-2 rounded-xl border p-3">
              {data.bankQuestions.slice(0, 5).map((bq) =>
                data.editable ? (
                  <form
                    key={bq.id}
                    action={importBankQuestionAction}
                    className="bg-muted/30 flex items-start gap-2 rounded-md p-2 text-xs"
                  >
                    <input type="hidden" name="evaluationId" value={data.evaluationId} />
                    <input type="hidden" name="sectionId" value={data.section.id} />
                    <input type="hidden" name="bankQuestionId" value={bq.id} />
                    <span className="flex-1 leading-snug">{bq.text}…</span>
                    <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      + Agregar
                    </Button>
                  </form>
                ) : (
                  <p key={bq.id} className="bg-muted/30 rounded-md p-2 text-xs leading-snug">
                    {bq.text}…
                  </p>
                ),
              )}
              {data.bankQuestions.length > 5 ? (
                <p className="text-muted-foreground px-1 text-[10px] italic">
                  … y {data.bankQuestions.length - 5} más en el banco
                </p>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Bloque de lectura (en modo no-edición) de una pregunta.
 *
 * Solo pinta el cuerpo de la card: enunciado + opciones A/B/C/D (con la
 * correcta destacada) + metadatos opcionales. La cabecera de la card
 * (número, pills de competencia/tipo, acciones Editar / Duplicar /
 * Eliminar) la provee el `QuestionEditor` que envuelve este componente.
 */
function QuestionReadView({ q }: { q: QuestionLite }) {
  return (
    <div className="space-y-3">
      <p className="text-foreground text-sm leading-snug">{renderTipTap(q.text)}</p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {q.options.map((opt) => {
          const isCorrect = opt.key === q.correctAnswer;
          return (
            <li
              key={opt.key}
              className={
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs " +
                (isCorrect
                  ? "border-primary bg-primary/10 text-foreground font-medium"
                  : "border-border bg-card text-muted-foreground")
              }
            >
              <span
                aria-hidden
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold " +
                  (isCorrect
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground")
                }
              >
                {opt.key}
              </span>
              <span className="leading-snug">{renderTipTap(opt.text)}</span>
            </li>
          );
        })}
      </ul>

      {q.soloLevel || q.menComponent ? (
        <p className="text-muted-foreground text-[11px]">
          {q.soloLevel ?? ""}
          {q.menComponent ? ` · ${q.menComponent}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/**
 * El texto de enunciado/opción viene como TipTap JSON. La función que lo
 * aplana vive en `./rich-text-flat` para poder testearse sin arrastrar el
 * bundle del cliente (`React`, `@tiptap/html`, etc.) a los unit tests.
 */
