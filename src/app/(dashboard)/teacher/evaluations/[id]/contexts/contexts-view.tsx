"use client";

import Link from "next/link";
import {
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  ListChecks,
  Send,
  Sparkles,
  Target,
  Timer,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DownloadPdfButton } from "../download-pdf-button";
import { submitForReviewAction } from "../../actions";
import { estimatedMinutes } from "./contexts-view-helpers";

// Re-export para que el API público (`@/app/.../contexts-view`) siga
// exponiendo `estimatedMinutes` como antes. El helper vive en su propio
// archivo para que los unit tests no importen este módulo cliente (que
// arrastra `submitForReviewAction` → `next-auth` → `next/server`).
export { estimatedMinutes };

/**
 * Tarjeta del índice de contextos: thumbnail 48×48 + título + snippet +
 * footer con stats (preguntas, tiempo, competencias) + CTA "Abrir".
 */
export interface ContextCardData {
  id: string;
  order: number;
  title: string | null;
  /** Texto plano derivado del TipTap JSON del section.content. */
  snippet: string;
  questionCount: number;
  /** Deduplicado de Question.competency; vacío si nadie lo tenía. */
  competencies: string[];
  /** True si al menos una pregunta del contexto trae imagen adjunta. */
  hasFigure: boolean;
}

interface ContextsViewProps {
  evaluationId: string;
  evaluationTitle: string;
  editable: boolean;
  contexts: ContextCardData[];
  /** Total de preguntas en la formulación. Se usa para mostrar/ocultar el
   *  CTA "Enviar a revisión" cuando hay al menos una pregunta. */
  totalQuestions: number;
}

/**
 * Estimación muy simple: 2.5 min/pregunta, mínimo 2 min para evitar mostrar
 * "0 min" cuando hay una sola pregunta fácil. Solo se usa como pista visual.
 *
 * (La implementación vive en `./contexts-view-helpers`; se re-exporta más
 * arriba para preservar el API público.)
 */

function ContextCard({ ctx, evaluationId }: { ctx: ContextCardData; evaluationId: string }) {
  const heading = ctx.title ?? `Contexto ${ctx.order + 1}`;
  const detailHref = `/teacher/evaluations/${evaluationId}/contexts/${ctx.id}`;
  const Icon = ctx.hasFigure ? ImageIcon : FileText;
  const thumbFill = ctx.hasFigure ? "bg-primary" : "bg-brand-blue-tint";
  const iconFill = ctx.hasFigure ? "text-primary-foreground" : "text-primary";
  const linkClass = buttonVariants({ variant: "outline", size: "sm" });

  return (
    <article className="bg-card space-y-4 rounded-xl border p-5">
      <header className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${thumbFill}`}
        >
          <Icon className={`h-5 w-5 ${iconFill}`} />
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Contexto {ctx.order + 1}
          </p>
          <h3 className="font-display text-lg leading-tight font-semibold">{heading}</h3>
          {ctx.snippet ? (
            <p className="text-muted-foreground line-clamp-3 text-sm leading-snug">{ctx.snippet}</p>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              Sin enunciado. Pulsa &quot;Abrir&quot; para añadir un texto, gráfico o tabla.
            </p>
          )}
        </div>

        <Link href={detailHref} className={linkClass}>
          Abrir →
        </Link>
      </header>

      <footer className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold">
          <ListChecks className="h-3 w-3" />
          {ctx.questionCount} enunciados{ctx.questionCount === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-1 font-medium">
          <Timer className="h-3 w-3" />~{estimatedMinutes(ctx.questionCount)} min
        </span>
        {ctx.competencies.length > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium">
            <Target className="h-3 w-3" />
            {ctx.competencies.join(" · ")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 italic">Sin competencias</span>
        )}
        <Link
          href={detailHref}
          className="text-primary ml-auto inline-flex items-center gap-1 font-semibold hover:underline"
        >
          Ver Enunciados →
        </Link>
      </footer>
    </article>
  );
}

export function ContextsView({
  evaluationId,
  evaluationTitle,
  editable,
  contexts,
  totalQuestions,
}: ContextsViewProps) {
  const importLinkClass = buttonVariants({ variant: "outline", size: "sm" });
  const canSubmitForReview = editable && totalQuestions > 0;
  return (
    <section aria-label="Contextos de la formulación" className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">
            {contexts.length} Contexto{contexts.length === 1 ? "" : "s"} / {totalQuestions} Ítem
            {totalQuestions === 1 ? "" : "s"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {contexts.length === 0
              ? `Aún no hay contextos en "${evaluationTitle}". Crea el primero abajo.`
              : "Cada contexto agrupa preguntas que comparten un texto, gráfico o tabla. Selecciona uno para abrirlo en el editor."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/teacher/evaluations/${evaluationId}/import`} className={importLinkClass}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Importar con IA
          </Link>
          <Link
            href={`/teacher/evaluations/${evaluationId}/designer`}
            className={importLinkClass}
            title="Diseñar portada del cuadernillo"
          >
            <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Diseñador
          </Link>
          <DownloadPdfButton evaluationId={evaluationId} variant="button" />
          {canSubmitForReview ? (
            <form action={submitForReviewAction}>
              <input type="hidden" name="evaluationId" value={evaluationId} />
              <Button type="submit" size="sm">
                <Send className="mr-1 h-3.5 w-3.5" /> Enviar a revisión
              </Button>
            </form>
          ) : null}
        </div>
      </header>

      {contexts.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
          Cuando importes preguntas con IA o crees el primer contexto desde abajo, lo verás listado
          aquí con su snippet, número de preguntas y competencias.
        </p>
      ) : (
        <div className="space-y-3">
          {contexts.map((ctx) => (
            <ContextCard key={ctx.id} ctx={ctx} evaluationId={evaluationId} />
          ))}
        </div>
      )}

      {!editable ? (
        <p className="bg-muted/30 text-muted-foreground rounded-md p-3 text-xs">
          Esta formulación no se puede editar en su estado actual. Para modificar contextos o
          preguntas, espera a que vuelva a borrador o contacta al coordinador.
        </p>
      ) : null}
    </section>
  );
}
