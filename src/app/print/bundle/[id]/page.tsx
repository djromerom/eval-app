import { Fragment } from "react";
import type { Metadata } from "next";
import "@/styles/print.css";
import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { inlineSectionsImages } from "@/modules/uploads/application/inline-content-images";
import { isWideQuestion } from "@/modules/printing/domain/wide-question";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { computeCoverTable, formatDuration } from "@/modules/bundles/domain/cover-table";
import { getResolvedBundleTheme } from "@/modules/theme/application/get-resolved-bundle-theme";
import { themeToCssVars } from "@/modules/theme/domain/theme";
import { RichText, RichTextInline } from "@/components/editor/rich-text";
import { richTextToPlain } from "@/components/editor/render";
import { PrintButton } from "../../evaluation/[id]/print-button";

export const metadata: Metadata = { title: "Vista previa del cuadernillo" };

const INSTRUCTIONS = [
  "Lee cada pregunta cuidadosamente y elige UNA opción.",
  "La hoja de respuestas será entregada por separado por el docente.",
  "Por favor, responde TODAS las preguntas.",
  "Esta prueba brindará información sobre los aprendizajes para mejorar dentro del aula de clase y sirve como insumo para la planeación de clases.",
];

const KEYS = ["A", "B", "C", "D"] as const;

interface CompetencyRow {
  competency: string;
  questions: number[];
}

function buildCompetencyRows(
  sections: { questions: { globalNumber: number; competency: string | null }[] }[],
): CompetencyRow[] {
  const map = new Map<string, number[]>();
  for (const section of sections) {
    for (const q of section.questions) {
      const key = q.competency || "Sin especificar";
      const list = map.get(key) ?? [];
      list.push(q.globalNumber);
      map.set(key, list);
    }
  }
  return Array.from(map.entries()).map(([competency, questions]) => ({
    competency,
    questions,
  }));
}

/** Pregunta con el campo extra `globalNumber` (numeración continua del
 *  cuadernillo 1..N). El resto de campos del `Question` se preservan con `&`,
 *  pero el helper los serializa por construcción. */
type BundledQuestion = {
  id: string;
  number: number;
  competency: string | null;
  globalNumber: number;
};

/** Asigna a cada pregunta del cuadernillo un número global 1..N respetando el
 *  orden del bundle (items.order → sections.order → questions.number). Las
 *  formulaciones independientes arrastran su `q.number` original (que puede
 *  tener gaps o solaparse entre sí); el booklet, la hoja de respuestas y la
 *  clave del cuadernillo comparten esta numeración continua.
 *
 *  Trabajamos con `unknown` y un cast final porque el shape completo del
 *  `Evaluation` (con `RichText` y decenas de campos) es demasiado ruidoso
 *  para pasarlo por una mónada genérica, y la maquetación solo necesita saber
 *  que `q.globalNumber` existe. La forma se valida implícitamente cuando el
 *  componente la recorre para renderizar. */
function renumberCuadernilloQuestions<Item>(
  entries: { item: Item; evaluation: unknown }[],
): { item: Item; evaluation: unknown }[] {
  let counter = 1;
  return entries.map(({ item, evaluation }) => {
    const ev = evaluation as {
      sections: { id: string; questions: BundledQuestion[] }[];
    };
    return {
      item,
      evaluation: {
        ...ev,
        sections: ev.sections.map((section) => ({
          ...section,
          questions: section.questions.map((q) => ({
            ...q,
            globalNumber: counter++,
          })),
        })),
      },
    };
  });
}

/**
 * Render server-side del booklet completo del bundle (cuadernillo). Lo abre
 * el worker de Puppeteer con un token firmado (kind = "bundle"). Genera:
 *   1. Portada con tabla de áreas agrupadas por parentSubject.
 *   2. Booklet de cada evaluation en orden, con numeración continua.
 *
 * Sprint 1 entrega este path; la hoja de respuestas unificada entra en Sprint 2.
 */
export default async function PrintBundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const actor = await resolvePrintActor(t, { bundleId: id, kind: "bundle" });

  const [bundleRes, instRes] = await Promise.all([
    makeGetBundle().execute({ actor, bundleId: id }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!bundleRes.ok) notFound();

  const bundle = bundleRes.value;
  const institution = instRes.ok ? instRes.value : null;
  const institutionName = institution?.name ?? "";
  const coverTable = computeCoverTable(bundle.items);

  // Cargamos cada evaluation con su detail para renderizar el booklet completo.
  const getEvaluation = makeGetEvaluation();
  const evaluations = await Promise.all(
    bundle.items.map(async (item) => {
      const r = await getEvaluation.execute({ actor, id: item.evaluationId });
      if (!r.ok) return null;
      // Igual que en el booklet de una formulación: las imágenes se incrustan
      // porque Puppeteer no puede autenticarse contra /api/uploads.
      return {
        item,
        evaluation: {
          ...r.value,
          sections: await inlineSectionsImages(r.value.sections, (p) => localStorage.read(p)),
        },
      };
    }),
  );
  const filteredEvaluations = evaluations.filter((e): e is NonNullable<typeof e> => e !== null);
  // Renumerar todas las preguntas del cuadernillo de corrido 1..N. La hoja
  // unificada de respuestas y la clave de respuestas ya usan su propio
  // `globalCounter` (mismo orden ⇒ mismos números); aquí los hacemos
  // coincidir con una sola fuente de verdad visual.
  type BundledEval = NonNullable<(typeof filteredEvaluations)[number]>["evaluation"] & {
    sections: {
      id: string;
      questions: (NonNullable<
        (typeof filteredEvaluations)[number]
      >["evaluation"]["sections"][number]["questions"][number] & { globalNumber: number })[];
    }[];
  };
  const renumbered = renumberCuadernilloQuestions(
    filteredEvaluations as {
      item: NonNullable<(typeof filteredEvaluations)[number]>["item"];
      evaluation: unknown;
    }[],
  );
  const validEvaluations: {
    item: (typeof filteredEvaluations)[number]["item"];
    evaluation: BundledEval;
  }[] = filteredEvaluations.map((entry, idx) => ({
    item: entry.item,
    evaluation: renumbered[idx]!.evaluation as BundledEval,
  }));

  // Para el booklet label usamos bookletNumber o "1".
  const bookletLabel = `CUADERNILLO ${bundle.bookletNumber ?? 1}`;

  // Tema: institución + override del cuadernillo. Antes heredaba del tema
  // de la primera formulación del bundle (cualquier edición del admin al
  // tema del cuadernillo se ignoraba). Ver get-resolved-bundle-theme.ts.
  const theme = await getResolvedBundleTheme(actor.institutionId, bundle.id);
  const logoSrc = await readLogoIfNeeded(institution?.logo, theme.showLogo);
  const cssVars = themeToCssVars(theme) as Record<string, string>;

  return (
    <div className="booklet" style={cssVars}>
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          Vista previa de impresión — Cuadernillo ({bundle.items.length} formulación
          {bundle.items.length === 1 ? "" : "es"}, {coverTable.totalQuestions} preguntas)
        </span>
        <PrintButton />
      </div>

      {/* ===== Página 1: portada del cuadernillo ===== */}
      <section className="sheet cover">
        {logoSrc ? <img src={logoSrc} alt="" className="cover-logo" /> : null}
        <p className="cover-institution print-accent">{institutionName}</p>
        <p className="cover-test-title">{bundle.name}</p>

        {/* Tabla de áreas agrupadas por parentSubject — el "tabla de áreas" del
            ejemplo real. Caso N=1: una sola área con un solo subject. */}
        {coverTable.areas.length > 0 && (
          <div className="competencies-section">
            <p className="competencies-title">Tabla de áreas</p>
            <table className="competencies-table">
              <thead>
                <tr>
                  <th>Área</th>
                  <th>Asignatura</th>
                  <th>Preguntas</th>
                  <th>Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {coverTable.areas.flatMap((area) =>
                  area.subjects.map((subj, i) => (
                    <tr key={`${area.name}-${subj.name}`}>
                      <td>{i === 0 ? area.name : ""}</td>
                      <td>{subj.name}</td>
                      <td className="text-center">{subj.questions}</td>
                      <td className="text-center">{formatDuration(subj.minutes)}</td>
                    </tr>
                  )),
                )}
                <tr>
                  <td colSpan={2}>
                    <strong>Total</strong>
                  </td>
                  <td className="text-center">
                    <strong>{coverTable.totalQuestions}</strong>
                  </td>
                  <td className="text-center">
                    <strong>{formatDuration(coverTable.totalMinutes)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="cover-booklet-number">{bookletLabel}</p>

        <p className="cover-greeting">¡Hola!</p>

        <p className="cover-instructions-title">Instrucciones</p>
        <p className="cover-instructions-intro">
          A continuación encontrarás una serie de preguntas de selección múltiple con única
          respuesta. Lee con atención cada pregunta y responde en la hoja de respuestas.
        </p>
        <ul className="cover-instructions-list">
          {INSTRUCTIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <div className="mark-example">
          <span>Marca así:</span>
          {KEYS.map((k) => (
            <span key={k} className={`omr-bubble ${k === "A" ? "filled" : ""}`}>
              {k}
            </span>
          ))}
        </div>

        <div className="student-fields">
          <div className="student-field">
            <span className="student-field-label">Nombres y apellidos:</span>
            <span className="student-field-line" />
          </div>
          <div className="student-field">
            <span className="student-field-label">Grado:</span>
            {/* Si el cuadernillo es de un curso concreto, el grado va preimpreso;
                si es cross-course, el estudiante lo escribe sobre la línea. */}
            {bundle.courseName ? (
              <span className="student-field-value">{bundle.courseName}</span>
            ) : (
              <span className="student-field-line" />
            )}
          </div>
          <div className="student-field">
            <span className="student-field-label">Fecha:</span>
            <span className="student-field-line" />
          </div>
        </div>

        <div className="fold-line" />
      </section>

      {/* ===== Páginas 2+: booklet de cada evaluation ===== */}
      {validEvaluations.map(({ item, evaluation }, evalIdx) => {
        const competencyRows = buildCompetencyRows(evaluation.sections);
        return (
          <div key={item.id} className="bundle-eval-section">
            {/* Apertura de la formulación: franja destacada que encadena con
                sus preguntas en la misma hoja. Antes era una página completa
                para dos líneas — en un cuadernillo de 3 asignaturas eso son 3
                cartas casi vacías. La franja sigue marcando con claridad
                dónde empieza cada asignatura. */}
            {evalIdx > 0 ? (
              <div className="bundle-eval-band">
                <span className="bundle-eval-band-title">{evaluation.title}</span>
                <span className="bundle-eval-band-part">
                  Parte {item.order} de {validEvaluations.length}
                </span>
              </div>
            ) : null}
            {/* UN solo contenedor por formulación, igual que en el booklet de
                una formulación suelta: a dos columnas el texto fluye de la
                izquierda a la derecha y de ahí a la página siguiente. Con un
                contenedor por contexto, Chrome balancea mal al fragmentar. */}
            <section className="sheet questions">
              <div className="questions-flow" data-columns={theme.questionColumns}>
                {evaluation.sections.map((section, idx) => {
                  const numbers = section.questions.map(
                    (q) => (q as unknown as { globalNumber: number }).globalNumber,
                  );
                  const first = numbers[0];
                  const last = numbers[numbers.length - 1];
                  const hasContext = richTextToPlain(section.content).length > 0;
                  return (
                    <Fragment key={section.id}>
                      {idx > 0 ? (
                        <hr className={`section-divider ${theme.sectionDivider}`} />
                      ) : null}

                      {/* Agrupado para que el contexto no se separe de su 1ª pregunta. */}
                      <div className="block-intro">
                        {numbers.length > 0 && (
                          <p className="block-lead">
                            RESPONDA LAS PREGUNTAS {first} A LA {last}
                            {hasContext || section.title
                              ? " DE ACUERDO CON LA SIGUIENTE INFORMACIÓN"
                              : ""}
                          </p>
                        )}
                        {section.title ? (
                          <p className="block-text-title">«{section.title}»</p>
                        ) : null}
                        {hasContext ? (
                          <RichText value={section.content} className="context-paragraph" />
                        ) : null}
                      </div>

                      {section.questions.map((q) => (
                        <div key={q.id} className={`question${isWideQuestion(q) ? "wide" : ""}`}>
                          <p className="question-text">
                            {(q as unknown as { globalNumber: number }).globalNumber}.{" "}
                            <RichTextInline value={q.text} />
                          </p>
                          <ul className="question-options">
                            {q.options.map((o) => (
                              <li key={o.key}>
                                {o.key}. <RichTextInline value={o.text} />
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
            {/* Sin `sheet`: encadena tras las preguntas de su formulación en
                lugar de abrir hoja nueva. `break-inside: avoid` en el CSS
                evita que la tabla se parta por la mitad. */}
            {competencyRows.length > 0 && (
              <div className="competencies-block">
                <p className="competencies-title">¿Qué competencias evaluamos?</p>
                <table className="competencies-table">
                  <thead>
                    <tr>
                      <th>Competencia</th>
                      <th>Preguntas</th>
                      <th>Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {competencyRows.map((row) => (
                      <tr key={row.competency}>
                        <td>{row.competency}</td>
                        <td className="text-center">
                          {row.questions
                            .sort((a, b) => a - b)
                            .map((n, i) => (
                              <span key={n}>
                                {i > 0 && row.questions.length > 3
                                  ? i < row.questions.length - 1
                                    ? ", "
                                    : " y "
                                  : i > 0
                                    ? ", "
                                    : ""}
                                {n}
                              </span>
                            ))}
                        </td>
                        <td className="text-center">{row.questions.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {theme.footerText ? <div className="print-footer">{theme.footerText}</div> : null}
    </div>
  );
}

async function readLogoIfNeeded(
  path: string | null | undefined,
  showLogo: boolean,
): Promise<string | null> {
  if (!showLogo || !path) return null;
  const { existsSync } = await import("node:fs");
  const candidates = [
    path,
    path.startsWith("/") ? path : `${process.env.STORAGE_DIR ?? "./storage"}/${path}`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const buf = await readFile(candidate);
        const ext = candidate.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        return `data:image/${ext};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    }
  }
  return null;
}
