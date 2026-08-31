import { Fragment } from "react";
import type { Metadata } from "next";
import "@/styles/print.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { isPrintable } from "@/modules/evaluations/domain/evaluation-status";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { getResolvedTheme } from "@/modules/theme/application/get-resolved-theme";
import { themeToCssVars } from "@/modules/theme/domain/theme";
import { RichText, RichTextInline } from "@/components/editor/rich-text";
import { richTextHasRenderableContent } from "@/shared/domain/rich-text";
import { inlineSectionsImages } from "@/modules/uploads/application/inline-content-images";
import { isWideQuestion } from "@/modules/printing/domain/wide-question";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Vista previa de impresión" };

export default async function PrintEvaluationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const actor = await resolvePrintActor(t, { evaluationId: id, kind: "booklet" });

  const [evalRes, csRes, theme] = await Promise.all([
    makeGetEvaluation().execute({ actor, id }),
    makeListCourseSubjects().execute({ actor }),
    getResolvedTheme(actor.institutionId, id),
  ]);
  if (!evalRes.ok) notFound();

  // Las imágenes subidas se incrustan como data: URI. El worker de PDF carga
  // esta página con un token en la query string, así que una petición aparte
  // a /api/uploads (sin sesión ni token) saldría 404 y la imagen rota.
  const evaluation = {
    ...evalRes.value,
    sections: await inlineSectionsImages(evalRes.value.sections, (p) => localStorage.read(p)),
  };
  const cs = csRes.ok ? csRes.value.find((c) => c.id === evaluation.courseSubjectId) : undefined;
  const area = cs?.subjectName ?? "";
  const grade = cs?.courseName ?? "";
  const bookletLabel = evaluation.bookletNumber != null ? ` ${evaluation.bookletNumber}` : "";

  const cssVars = themeToCssVars(theme) as Record<string, string>;

  return (
    <div className="booklet" style={cssVars}>
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          Vista previa de impresión
          {!isPrintable(evaluation.status)
            ? " — la formulación aún no está PUBLICADA (borrador de referencia)."
            : "."}
        </span>
        <PrintButton />
      </div>

      {/* La portada del booklet de una formulación suelta se retiró a
          propósito: el PDF que se descarga desde el módulo de contextos
          arranca directo en las preguntas. El compendio (print/bundle/[id])
          conserva su propia portada, que es independiente de esta. */}

      {/* ===== Preguntas =====
          UN solo contenedor para todos los contextos: a dos columnas el texto
          fluye de la izquierda a la derecha y de ahí a la página siguiente.
          Con un contenedor por contexto, Chrome balanceaba mal al fragmentar
          entre páginas y no se ahorraba papel. */}
      <section className="sheet questions">
        <div className="print-page-header">
          ECU {grade}
          {bookletLabel}
        </div>
        {area ? <p className="subject-title">{area}</p> : null}
        <div className="questions-flow" data-columns={theme.questionColumns}>
          {evaluation.sections.map((section, idx) => {
            const numbers = section.questions.map((q) => q.number);
            const first = numbers[0];
            const last = numbers[numbers.length - 1];
            const hasContext = richTextHasRenderableContent(section.content);
            return (
              <Fragment key={section.id}>
                {/* Separador configurable (line / double / dots) — el primer
                    bloque no lleva, los demás sí. */}
                {idx > 0 ? <hr className={`section-divider ${theme.sectionDivider}`} /> : null}

                {/* Agrupado para que el contexto no se separe de su 1ª pregunta. */}
                <div className="block-intro">
                  {numbers.length > 1 && (
                    <p className="block-lead">
                      RESPONDA LAS PREGUNTAS {first} A LA {last}
                      {hasContext || section.title
                        ? " DE ACUERDO CON LA SIGUIENTE INFORMACIÓN"
                        : ""}
                    </p>
                  )}
                  {section.title ? <p className="block-text-title">{section.title}</p> : null}
                  {hasContext ? (
                    <RichText value={section.content} className="context-paragraph" />
                  ) : null}
                </div>

                {section.questions.map((q) => (
                  <div key={q.id} className={`question${isWideQuestion(q) ? "wide" : ""}`}>
                    <p className="question-text">
                      <span className="item-number">{q.number}.</span>{" "}
                      <RichTextInline value={q.text} />
                    </p>
                    <ul className="question-options">
                      {q.options.map((o) => (
                        <li key={o.key}>
                          <span className="option-letter">{o.key}.</span>{" "}
                          <RichTextInline value={o.text} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </Fragment>
            );
          })}
        </div>
        <div className="fold-line" />
      </section>

      {theme.footerText ? <div className="print-footer">{theme.footerText}</div> : null}
    </div>
  );
}
