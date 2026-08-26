import type { Metadata } from "next";
import "@/styles/print.css";
// Override del @page para esta ruta: la portada debe imprimirse full bleed
// (sin margen de 2cm del print.css), porque el worker la incrusta como
// mitad derecha de un pliego tabloid apaisado y cualquier margen se ve
// como franja blanca dentro del pliego. Se importa DESPUÉS de print.css
// para ganar por orden en el cascade de @page rules.
import "../../print-cover.css";
import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { resolvePrintActor } from "@/lib/print-access";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { makeGetMyInstitution } from "@/modules/institutions/infrastructure/container";
import { makePreviewCover } from "@/modules/bundle-cover/infrastructure/container";
import { fitCoverToIframe } from "@/modules/bundle-cover/application/fit-cover-to-iframe";
import { makeLoadCoverHtml } from "@/modules/cover-html/infrastructure/container";
import { computeCoverTable, formatDuration } from "@/modules/bundles/domain/cover-table";
import { getResolvedBundleTheme } from "@/modules/theme/application/get-resolved-bundle-theme";
import { themeToCssVars } from "@/modules/theme/domain/theme";
import { PrintButton } from "../../../evaluation/[id]/print-button";

export const metadata: Metadata = { title: "Vista previa de la portada" };

const INSTRUCTIONS = [
  "Lee cada pregunta cuidadosamente y elige UNA opción.",
  "La hoja de respuestas será entregada por separado por el docente.",
  "Por favor, responde TODAS las preguntas.",
  "Esta prueba brindará información sobre los aprendizajes para mejorar dentro del aula de clase y sirve como insumo para la planeación de clases.",
];

const KEYS = ["A", "B", "C", "D"] as const;

/**
 * Render server-side de SOLO la portada del cuadernillo (1 página, carta
 * portrait). Lo abre el worker PDF con un token firmado (kind = "cover-bundle")
 * cuando el docente pulsa "Descargar PDF" en /cover-html.
 *
 * Reutiliza la detección `customCoverHtml` (live HTML / override Monaco) y el
 * JSX fallback del print bundle original ([id]/page.tsx). NO imprime booklet
 * de preguntas ni hoja de respuestas — solo la hoja de portada.
 */
export default async function PrintCoverBundlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { id } = await params;
  const { t } = await searchParams;
  const actor = await resolvePrintActor(t, { bundleId: id, kind: "cover-bundle" });

  const [bundleRes, instRes] = await Promise.all([
    makeGetBundle().execute({ actor, bundleId: id }),
    makeGetMyInstitution().execute({ actor }),
  ]);
  if (!bundleRes.ok) notFound();

  const bundle = bundleRes.value;
  const institution = instRes.ok ? instRes.value : null;
  const institutionName = institution?.name ?? "";
  const coverTable = computeCoverTable(bundle.items);

  const bookletLabel = `CUADERNILLO ${bundle.bookletNumber ?? 1}`;

  // Tema: institución + override del cuadernillo (mismo cálculo que el print
  // bundle original — la portada es la misma, solo cambia lo que omitimos).
  const theme = await getResolvedBundleTheme(actor.institutionId, bundle.id);
  const logoSrc = await readLogoIfNeeded(institution?.logo, theme.showLogo);
  const cssVars = themeToCssVars(theme) as Record<string, string>;

  // Detección de cover custom (live HTML / override Monaco) — misma lógica
  // que /print/bundle/[id] para no introducir un cambio visual: si el docente
  // configuró la portada, gana sobre el JSX hardcoded. El HTML ya pasó por
  // DOMPurify en `RenderCover`, así que es seguro dentro del iframe.
  //
  // `fitCoverToIframe` prepende un `<style>` que neutraliza los anchos
  // fijos (ej. `.cover { width: 215.9mm }`) y márgenes auto — el cover
  // queda alineado al área imprimible del iframe en lugar de centrado
  // con franjas blancas laterales.
  const [liveStateRes, previewCoverRes] = await Promise.all([
    makeLoadCoverHtml().execute({ actor, bundleId: id }),
    makePreviewCover().execute({ actor, bundleId: id }),
  ]);
  const hasLiveHtml = liveStateRes.ok && liveStateRes.value.state.hasProject;
  const hasMonacoOverride = previewCoverRes.ok && previewCoverRes.value.source === "OVERRIDE";
  const hasCustomCover = hasLiveHtml || hasMonacoOverride;
  const customCoverHtml =
    hasCustomCover && previewCoverRes.ok ? fitCoverToIframe(previewCoverRes.value.html) : null;

  return (
    <div className="booklet" style={cssVars}>
      <div className="no-print bg-card sticky top-0 z-10 flex w-full max-w-[900px] items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="text-muted-foreground">
          Vista previa de impresión — Portada del cuadernillo ({bundle.items.length} formulación
          {bundle.items.length === 1 ? "" : "es"}, {coverTable.totalQuestions} preguntas)
        </span>
        <PrintButton />
      </div>

      {/* ===== Página única: portada del cuadernillo =====
       *
       * Esta ruta renderiza SOLO la portada (1 página carta 8.5×11in) para
       * previsualizar / descargar la portada actual. NO usa `.cover-sheet`
       * (la estructura flex de dos mitades que vive en `/print/bundle/[id]`)
       * porque aquí la portada va sola — el worker de PDF es quien decide
       * dónde ponerla (mitad derecha de un pliego tabloid apaisado) cuando
       * se compone el cuadernillo completo. Ver `workers/pdf.worker.ts`. */}
      <section className="sheet cover">
        {customCoverHtml ? (
          <iframe
            className="cover-custom"
            title="Portada del cuadernillo"
            sandbox=""
            srcDoc={customCoverHtml}
          />
        ) : (
          <>
            {logoSrc ? <img src={logoSrc} alt="" className="cover-logo" /> : null}
            <p className="cover-institution print-accent">{institutionName}</p>
            <p className="cover-test-title">{bundle.name}</p>

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
          </>
        )}
      </section>
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
