"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import {
  type EvaluationTheme,
  type ResolvedTheme,
  DENSITIES,
  DENSITY_LABELS,
  QUESTION_COLUMNS,
  QUESTION_COLUMNS_LABELS,
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  SECTION_DIVIDERS,
  SECTION_DIVIDER_LABELS,
  mergeTheme,
  themeToCssVars,
} from "@/modules/theme/domain/theme";
import { buildPreviewHtml } from "@/modules/theme/application/build-preview-html";
import {
  resetBundleThemeAction,
  saveBundleThemeAction,
  type BundleDesignerFormState,
} from "./actions";

interface Props {
  bundleId: string;
  initial: Partial<EvaluationTheme>;
  /** Tema ya colapsado con el institucional — para mostrar el estado actual al cargar. */
  resolved: ResolvedTheme;
  /** False si el compendio no está en DRAFT (no se puede editar). */
  editable: boolean;
}

/**
 * Form de override del tema por compendio.
 *
 * Layout 2 columnas:
 * - Izquierda: form de override (cover, intro, footer, colores, tipografía).
 * - Derecha: iframe `srcdoc` con la maqueta del cuadernillo aplicando el
 *   override ACTUAL del form (preview inmediato, sin recargar).
 *
 * Como `/print/bundle/[id]` vive en otro route group con su propio layout y
 * auth (Puppeteer-friendly), replicar la maqueta en srcdoc evita el
 * problema de iframar una página autenticada y permite preview sin cookie
 * ni cross-origin. La fidelidad al PDF real queda como deuda futura —
 * ver src/modules/theme/application/build-preview-html.tsx.
 *
 * Solo editable en DRAFT (regla de negocio aplicada en el use case
 * UpdateBundleTheme + campo fieldset disabled en la UI).
 */
export function BundleDesignerForm({ bundleId, initial, resolved, editable }: Props) {
  const [state, formAction] = useActionState<BundleDesignerFormState, FormData>(
    (prev, fd) => saveBundleThemeAction(bundleId, prev, fd),
    {},
  );
  const [resetState, resetAction] = useActionState<BundleDesignerFormState, FormData>(
    () => resetBundleThemeAction(bundleId),
    {},
  );

  const [primary, setPrimary] = useState(initial.primary ?? resolved.primary);
  const [fontFamily, setFontFamily] = useState(initial.fontFamily ?? resolved.fontFamily);
  const [density, setDensity] = useState(initial.density ?? resolved.density);
  const [questionColumns, setQuestionColumns] = useState(
    initial.questionColumns ?? resolved.questionColumns,
  );
  const [footerText, setFooterText] = useState(initial.footerText ?? resolved.footerText);
  const [showLogo, setShowLogo] = useState(initial.showLogo ?? resolved.showLogo);
  const [coverSubtitle, setCoverSubtitle] = useState(
    initial.coverSubtitle ?? resolved.coverSubtitle,
  );
  const [sectionDivider, setSectionDivider] = useState(
    initial.sectionDivider ?? resolved.sectionDivider,
  );
  // El editor TipTap maneja su propio estado interno (RichTextEditor) y solo
  // expone un hidden input con el JSON. Lo mantenemos aquí también para
  // poder pintar el preview en vivo sin re-renderizar el editor.
  const [introText, setIntroText] = useState<Record<string, unknown> | null>(
    initial.introText ?? resolved.introText,
  );

  // Resolved theme con los valores actuales del form para el preview en vivo.
  const liveResolved: ResolvedTheme = useMemo(
    () =>
      mergeTheme(resolved, {
        primary,
        fontFamily,
        density,
        questionColumns,
        footerText,
        showLogo,
        coverSubtitle,
        sectionDivider,
        introText,
      }),
    [
      resolved,
      primary,
      fontFamily,
      density,
      questionColumns,
      footerText,
      showLogo,
      coverSubtitle,
      sectionDivider,
      introText,
    ],
  );

  const cssVars = useMemo(() => themeToCssVars(liveResolved), [liveResolved]);
  const previewHtml = useMemo(() => buildPreviewHtml(liveResolved), [liveResolved]);

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      {/* ===== Columna izquierda: form ===== */}
      <div className="space-y-4">
        <form action={formAction} className="bg-card space-y-4 rounded-xl border p-5">
          <div>
            <h2 className="font-semibold">Tema de este compendio</h2>
            <p className="text-muted-foreground text-xs">
              Sobreescribe el tema institucional. Solo aplica a este compendio. En blanco = hereda
              del colegio.
            </p>
          </div>

          <fieldset className="space-y-3" disabled={!editable}>
            <Field label="Color primario">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  name="primary"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded border"
                  aria-label="Selector de color primario"
                />
                <Input
                  name="primaryDisplay"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  pattern="#[0-9a-fA-F]{6}"
                  maxLength={7}
                  className="w-28"
                  aria-hidden
                  tabIndex={-1}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPrimary(resolved.primary)}
                >
                  Heredar
                </Button>
              </div>
            </Field>

            <Field label="Tipografía">
              <select
                name="fontFamily"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {FONT_FAMILY_LABELS[f]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Densidad">
              <select
                name="density"
                value={density}
                onChange={(e) => setDensity(e.target.value as typeof density)}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {DENSITIES.map((d) => (
                  <option key={d} value={d}>
                    {DENSITY_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Columnas de preguntas">
              <select
                name="questionColumns"
                value={questionColumns}
                onChange={(e) =>
                  setQuestionColumns(Number(e.target.value) as typeof questionColumns)
                }
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {QUESTION_COLUMNS.map((c) => (
                  <option key={c} value={c}>
                    {QUESTION_COLUMNS_LABELS[c]}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-xs">
                A dos columnas, las preguntas con imagen o tabla siguen ocupando el ancho completo.
              </p>
            </Field>

            <Field label="Pie de página">
              <Input
                name="footerText"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                maxLength={200}
              />
            </Field>

            <Field label="Subtítulo de portada (período / fecha / grado)">
              <Input
                name="coverSubtitle"
                value={coverSubtitle}
                onChange={(e) => setCoverSubtitle(e.target.value)}
                maxLength={200}
                placeholder="Grado Undécimo · Periodo I · 2026"
              />
            </Field>

            <Field label="Separador entre secciones">
              <select
                name="sectionDivider"
                value={sectionDivider}
                onChange={(e) => setSectionDivider(e.target.value as typeof sectionDivider)}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
              >
                {SECTION_DIVIDERS.map((s) => (
                  <option key={s} value={s}>
                    {SECTION_DIVIDER_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="showLogo"
                checked={showLogo}
                onChange={(e) => setShowLogo(e.target.checked)}
                className="accent-primary h-4 w-4"
              />
              <span className="text-sm">Mostrar logo del colegio en portada</span>
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Bloque intro (antes de las preguntas)</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setIntroText(null)}
                  disabled={!introText}
                >
                  Quitar
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Aparece en la primera página del cuadernillo, antes de las preguntas. Útil para
                lecturas, fórmulas o instrucciones largas. Soporta fórmulas LaTeX con{" "}
                <code>$…$</code>.
              </p>
              <RichTextEditor
                name="introText"
                defaultValue={initial.introText ?? resolved.introText}
                onChange={(json) => setIntroText(json)}
                minHeightClass="min-h-32"
              />
            </div>
          </fieldset>

          {!editable ? (
            <p className="text-muted-foreground text-xs">
              El compendio no está en BORRADOR. Solo se puede editar el tema mientras esté en
              borrador.
            </p>
          ) : null}

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.success ? (
            <p className="text-success text-sm">Tema guardado. Vista previa actualizada.</p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <SubmitButton disabled={!editable} />
          </div>
        </form>

        {/* Form independiente — "Restablecer al institucional" no puede ir
            dentro del form principal (HTML invalida forms anidadas y React
            lanza hydration error). El `resetState.error` se mantiene acá
            abajo del form para que el feedback sea contextualmente claro. */}
        <form action={resetAction} className="bg-card space-y-3 rounded-xl border p-5">
          <p className="text-muted-foreground text-xs">
            Restablecer borra todos los override de este compendio y vuelve a usar el tema
            institucional como única fuente.
          </p>
          {resetState.error ? <p className="text-destructive text-sm">{resetState.error}</p> : null}
          <Button type="submit" variant="outline" disabled={!editable}>
            Restablecer al institucional
          </Button>
        </form>

        <div className="text-muted-foreground text-xs">
          Vista previa aplicada en tiempo real. Guardar persiste los cambios.
        </div>
      </div>

      {/* ===== Columna derecha: preview iframe ===== */}
      <div className="bg-muted/30 rounded-xl border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Vista previa del cuadernillo</h3>
          <span className="text-muted-foreground text-xs">
            tema: {cssVars["--print-font-family"]?.split(",")[0]} · {density}
          </span>
        </div>
        <iframe
          title="Vista previa del cuadernillo"
          srcDoc={previewHtml}
          className="h-[1400px] w-full rounded border bg-white"
          sandbox=""
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Guardando…" : "Guardar tema"}
    </Button>
  );
}
