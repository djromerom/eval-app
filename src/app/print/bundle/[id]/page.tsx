import type { Metadata } from "next";
import "@/styles/print.css";
import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { computeCoverTable, formatDuration } from "@/modules/bundles/domain/cover-table";
import { getResolvedBundleTheme } from "@/modules/theme/application/get-resolved-bundle-theme";
import { themeToCssVars } from "@/modules/theme/domain/theme";
import { RichText, RichTextInline } from "@/components/editor/rich-text";
import { richTextToPlain } from "@/components/editor/render";
import { PrintButton } from "../../evaluation/[id]/print-button";

export const metadata: Metadata = { title: "Vista previa del compendio" };

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
  sections: { questions: { number: number; competency: string | null }[] }[],
): CompetencyRow[] {
  const map = new Map<string, number[]>();
  for (const section of sections) {
    for (const q of section.questions) {
      const key = q.competency || "Sin especificar";
      const list = map.get(key) ?? [];
      list.push(q.number);
      map.set(key, list);
    }
  }
  return Array.from(map.entries()).map(([competency, questions]) => ({
    competency,
    questions,
  }));
}

/**
 * Render server-side del booklet completo del bundle (compendio). Lo abre
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
      return r.ok ? { item, evaluation: r.value } : null;
    }),
  );
  const validEvaluations = evaluations.filter((e): e is NonNullable<typeof e> => e !== null);

  // Para el booklet label usamos bookletNumber o "1".
  const bookletLabel = `CUADERNILLO ${bundle.bookletNumber ?? 1}`;

  // Tema: institución + override del compendio. Antes heredaba del tema
  // de la primera evaluación del bundle (cualquier edición del admin al
  // tema del compendio se ignoraba). Ver get-resolved-bundle-theme.ts.
  const theme = await getResolvedBundleTheme(actor.institutionId, bundle.id);
  const logoSrc = await readLogoIfNeeded(institution?.logo, theme.showLogo);
  const cssVars = themeToCssVars(theme) as Record<string, string>;

  return (
    <div className="booklet" style={cssVars}>
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          Vista previa de impresión — Compendio ({bundle.items.length} evaluación
          {bundle.items.length === 1 ? "" : "es"}, {coverTable.totalQuestions} preguntas)
        </span>
        <PrintButton />
      </div>

      {/* ===== Página 1: portada del compendio ===== */}
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
            {/* Si el compendio es de un curso concreto, el grado va preimpreso;
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
            {/* Header del bloque: nombre de la evaluation + orden. */}
            {evalIdx > 0 ? (
              <section className="sheet bundle-eval-cover">
                <h1 className="text-2xl font-bold">{evaluation.title}</h1>
                <p className="text-muted-foreground">
                  Parte {item.order} de {validEvaluations.length}
                </p>
                <div className="fold-line" />
              </section>
            ) : null}
            {evaluation.sections.map((section, idx) => {
              const numbers = section.questions.map((q) => q.number);
              const first = numbers[0];
              const last = numbers[numbers.length - 1];
              const hasContext = richTextToPlain(section.content).length > 0;
              return (
                <section key={section.id} className="sheet questions">
                  {idx > 0 ? <hr className={`section-divider ${theme.sectionDivider}`} /> : null}

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
                    {section.title ? <p className="block-text-title">«{section.title}»</p> : null}
                    {hasContext ? (
                      <RichText value={section.content} className="context-paragraph" />
                    ) : null}
                  </div>

                  {section.questions.map((q) => (
                    <div key={q.id} className="question">
                      <p className="question-text">
                        {q.number}. <RichTextInline value={q.text} />
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

                  <div className="fold-line" />
                </section>
              );
            })}
            {competencyRows.length > 0 && (
              <section className="sheet competencies-section">
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
                <div className="fold-line" />
              </section>
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
