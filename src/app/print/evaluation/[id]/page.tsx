import { Fragment } from "react";
import type { Metadata } from "next";
import "@/styles/print.css";
import "@/styles/print-page-number.css";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { isPrintable } from "@/modules/evaluations/domain/evaluation-status";
import type { EvaluationSection } from "@/modules/evaluations/domain/evaluation";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { getResolvedTheme } from "@/modules/theme/application/get-resolved-theme";
import { themeToCssVars } from "@/modules/theme/domain/theme";
import { RichText, RichTextInline } from "@/components/editor/rich-text";
import { richTextHasRenderableContent } from "@/shared/domain/rich-text";
import { inlineSectionsImages } from "@/modules/uploads/application/inline-content-images";
import { isWideQuestion } from "@/modules/printing/domain/wide-question";
import { resolveGroupDensity } from "@/modules/printing/domain/section-density";
import { groupSectionsForPrint } from "@/modules/printing/domain/section-grouping";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { PrintImageSizer } from "../../_components/print-image-sizer";
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
      {/* Ajusta el tamaño de las imágenes al tamaño real del archivo, para
          que no salgan ampliadas (y por tanto borrosas) en el papel. */}
      <PrintImageSizer />
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
          {groupSectionsForPrint(evaluation.sections).map((group) => {
            // Densidad a nivel de grupo: las "ninguno" consecutivas se
            // suman y la heurística por chars/ítem decide si el bloque
            // entero cabe en 2-col. El override del docente se respeta
            // solo en `single` y en la 1ª sección de un `none-merged`.
            const density = resolveGroupDensity(group);
            const sectionsInGroup: EvaluationSection[] =
              group.kind === "single" ? [group.section] : group.sections;
            const allNumbers = sectionsInGroup.flatMap((s) =>
              s.questions.map((q: { number: number }) => q.number),
            );
            const first = allNumbers[0];
            const last = allNumbers[allNumbers.length - 1];
            const isMerged = group.kind === "none-merged";
            // block-intro: en `single`, usa su título/contenido; en
            // `none-merged`, solo la 1ª sección emite contexto (y los
            // section-divider intermedios entre las demás "ninguno" se
            // suprimen ya que están en el mismo grupo).
            const headSection = sectionsInGroup[0]!;
            const headHasContext = richTextHasRenderableContent(headSection.content);
            const showLead = allNumbers.length > 1 && (headHasContext || headSection.title);
            return (
              <Fragment key={isMerged ? `merged-${headSection.id}` : headSection.id}>
                {/* Wrapper común por grupo: pega el intro con sus preguntas
                    cuando el bloque es "ninguno" suelto (intro vacío, 1
                    pregunta) o "específico" (intro poblado + 1 pregunta).
                    `data-print-group-density` activa `column-span: all`
                    solo cuando la densidad es low (mismo rol que el
                    histórico .block-intro en 2-col).

                    Pedido del docente (sep 2026): sin separador visual entre
                    bloques — los contextos se encadenan directamente. Antes
                    había un <hr className="section-divider"> opcional (line
                    / double / dots) configurable por theme; se quitó para
                    dar continuidad visual entre contextos. El bundle-eval-band
                    (la franja gris "ECU GRADO N°" entre asignaturas dentro
                    del cuadernillo) sigue intacto en otra capa. */}
                <div className="print-group" data-print-group-density={density}>
                  {/* Agrupado para que el contexto no se separe de su 1ª pregunta.
                      En `none-merged`, el head emite intro; las demás secciones
                      del grupo se renderean sin su propio intro ni divider. */}
                  <div
                    className="block-intro"
                    data-empty={!headSection.title && !headHasContext ? "true" : undefined}
                  >
                    {showLead && (
                      <p className="block-lead">
                        RESPONDA LAS PREGUNTAS {first} A LA {last} DE ACUERDO CON LA SIGUIENTE
                        INFORMACIÓN
                      </p>
                    )}
                    {headSection.title ? (
                      <p className="block-text-title">{headSection.title}</p>
                    ) : null}
                    {headHasContext ? (
                      <RichText value={headSection.content} className="context-paragraph" />
                    ) : null}
                  </div>

                  {/* Contenedor de las preguntas de ESTE grupo.
                      data-density="low" activa el layout de 2 columnas en
                      print.css; "high" mantiene el flujo vertical normal.
                      Las preguntas wide (con imagen/tabla) ya tienen
                      column-span: all, así que cruzan ambas columnas
                      sin importar la densidad. */}
                  <ul className="questions-list" data-density={density}>
                    {sectionsInGroup.flatMap((s) =>
                      s.questions.map((q) => (
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
                      )),
                    )}
                  </ul>
                </div>
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
