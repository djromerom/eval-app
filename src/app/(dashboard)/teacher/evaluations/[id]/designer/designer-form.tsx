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
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  SECTION_DIVIDERS,
  SECTION_DIVIDER_LABELS,
  mergeTheme,
  themeToCssVars,
} from "@/modules/theme/domain/theme";
import {
  resetEvaluationThemeAction,
  saveEvaluationThemeAction,
  type DesignerFormState,
} from "./actions";

interface Props {
  evaluationId: string;
  initial: Partial<EvaluationTheme>;
  /** Tema ya colapsado con el institucional — para mostrar el estado actual al cargar. */
  resolved: ResolvedTheme;
  /** False si la evaluación no está en DRAFT (no se puede editar). */
  editable: boolean;
}

/**
 * Form de override del tema por evaluación.
 *
 * Layout 2 columnas:
 * - Izquierda: form de override (sección por sección del cuadernillo).
 * - Derecha: iframe `srcdoc` con el cuadernillo aplicando el override
 *   ACTUAL del form (preview inmediato, sin recargar). Como `/print/...`
 *   vive en otro route group con su propio layout y auth, replicar el
 *   booklet en srcdoc evita el problema de iframar una página autenticada
 *   y permite preview sin cookie ni cross-origin.
 *
 * Si en el futuro la fidelidad pixel-perfect del preview es crítica, mover
 * el iframe a una página real con un query-string `?preview=1` y dejar que
 * el server renderice — pero esa migración no es prioritaria ahora.
 */
export function DesignerForm({ evaluationId, initial, resolved, editable }: Props) {
  const [state, formAction] = useActionState<DesignerFormState, FormData>(
    (prev, fd) => saveEvaluationThemeAction(evaluationId, prev, fd),
    {},
  );
  const [resetState, resetAction] = useActionState<DesignerFormState, FormData>(
    () => resetEvaluationThemeAction(evaluationId),
    {},
  );

  const [primary, setPrimary] = useState(initial.primary ?? resolved.primary);
  const [fontFamily, setFontFamily] = useState(initial.fontFamily ?? resolved.fontFamily);
  const [density, setDensity] = useState(initial.density ?? resolved.density);
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
            <h2 className="font-semibold">Tema de esta evaluación</h2>
            <p className="text-muted-foreground text-xs">
              Sobreescribe el tema institucional. Solo aplica a esta evaluación. En blanco = hereda
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

            <Field label="Pie de página">
              <Input
                name="footerText"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                maxLength={200}
              />
            </Field>

            <Field label="Subtítulo de portada (período / fecha)">
              <Input
                name="coverSubtitle"
                value={coverSubtitle}
                onChange={(e) => setCoverSubtitle(e.target.value)}
                maxLength={200}
                placeholder="Período I · 2026"
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
              La evaluación no está en BORRADOR. Solo se puede editar el tema mientras esté en
              borrador.
            </p>
          ) : null}

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.success ? (
            <p className="text-success text-sm">Tema guardado. Vista previa actualizada.</p>
          ) : null}
          {resetState.error ? <p className="text-destructive text-sm">{resetState.error}</p> : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <SubmitButton disabled={!editable} />
            <form action={resetAction}>
              <Button type="submit" variant="outline" disabled={!editable}>
                Restablecer al institucional
              </Button>
            </form>
          </div>
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

/**
 * Construye un HTML reducido del cuadernillo aplicando `themeToCssVars()`.
 *
 * No renderiza el cuadernillo real (eso vive en `/print/...` con auth,
 * estilos completos y tipografía real). Este preview muestra una maqueta
 * con la MISMA CSS-variable bridge que la página real — suficiente para
 * que el docente vea el efecto de cada ajuste antes de imprimir.
 */
function buildPreviewHtml(theme: ResolvedTheme): string {
  const cssVars = themeToCssVars(theme);
  const vars = Object.entries(cssVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
  // Render plano del TipTap JSON para el preview (no necesitamos rich-text
  // exacto, solo que el docente vea que su bloque aparece antes de las
  // preguntas). La página real usa el `RichText` component.
  const introHtml = theme.introText ? renderTipTapPreview(theme.introText) : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  :root { ${vars} }
  body {
    font-family: var(--print-font-family);
    line-height: var(--print-line-height);
    color: #111;
    margin: 0;
    padding: 24px;
  }
  .cover {
    text-align: center;
    padding: 40px 20px;
    border: 2px solid var(--print-primary);
  }
  .cover-logo {
    display: var(--print-show-logo);
    width: 80px; height: 80px;
    margin: 0 auto 16px;
    border: 1px dashed #999;
    border-radius: 4px;
    line-height: 80px;
    color: #999;
    font-size: 11px;
  }
  .cover h1 { color: var(--print-primary); font-size: 22px; margin: 8px 0; }
  .cover h2 { font-size: 14px; margin: 4px 0; font-weight: normal; }
  .cover .subtitle { color: var(--print-primary); font-weight: bold; }
  .intro {
    background: #fafafa;
    border-left: 3px solid var(--print-primary);
    padding: 10px 14px;
    margin: 18px 0;
    font-size: 13px;
  }
  .intro p { margin: 4px 0; }
  .intro h3 { color: var(--print-primary); font-size: 14px; margin: 6px 0 4px; }
  .intro ul, .intro ol { margin: 4px 0 4px 20px; }
  .section-divider {
    border: 0;
    margin: 18px 0;
    border-top: 1px solid var(--print-primary);
  }
  .section-divider.double { border-top: 3px double var(--print-primary); }
  .section-divider.dots { border-top: 1px dotted var(--print-primary); height: 6px; }
  .q { margin: 10px 0; }
  .footer {
    margin-top: 30px;
    padding-top: 6px;
    border-top: 1px solid #ccc;
    text-align: center;
    font-size: 10px;
    color: #555;
  }
  .footer::before { content: var(--print-footer-text); }
</style>
</head>
<body>
  <div class="cover">
    <div class="cover-logo">logo</div>
    <h1>I.E. Colegio Demo</h1>
    <h2>Prueba de Matemáticas — 11°</h2>
    ${theme.coverSubtitle ? `<p class="subtitle">${escapeHtml(theme.coverSubtitle)}</p>` : ""}
  </div>
  ${introHtml}
  <hr class="section-divider ${theme.sectionDivider}" />
  <div class="q"><strong>1.</strong> ¿Cuál es el resultado de 2 + 2?</div>
  <div class="q"><strong>2.</strong> Pregunta de opción múltiple con 4 alternativas…</div>
  <hr class="section-divider ${theme.sectionDivider}" />
  <div class="q"><strong>3.</strong> Otra pregunta después del divisor de sección.</div>
  <div class="footer"></div>
</body>
</html>`;
}

/**
 * Render minimalista de TipTap JSON para el preview. Solo necesitamos los
 * nodos que el docente típicamente usa en un intro (paragraph, heading,
 * bulletList, orderedList). Los nodos desconocidos se ignoran.
 */
function renderTipTapPreview(doc: Record<string, unknown>): string {
  const out: string[] = [];
  const content = Array.isArray(doc.content) ? (doc.content as unknown[]) : [];
  for (const node of content) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    const text = collectText(n);
    switch (n.type) {
      case "paragraph":
        out.push(`<p>${escapeHtml(text)}</p>`);
        break;
      case "heading": {
        const level =
          typeof n.attrs === "object" && n.attrs && "level" in n.attrs
            ? ((n.attrs as { level?: number }).level ?? 3)
            : 3;
        out.push(`<h${level}>${escapeHtml(text)}</h${level}>`);
        break;
      }
      case "bulletList":
        out.push(renderList(n, "ul"));
        break;
      case "orderedList":
        out.push(renderList(n, "ol"));
        break;
      default:
        // Bloque desconocido (blockquote, codeBlock, etc.) → solo el texto.
        if (text) out.push(`<p>${escapeHtml(text)}</p>`);
        break;
    }
  }
  return out.length ? `<div class="intro">${out.join("")}</div>` : "";
}

function renderList(n: Record<string, unknown>, tag: "ul" | "ol"): string {
  const items = Array.isArray(n.content) ? (n.content as unknown[]) : [];
  const li = items
    .map((it) => {
      if (!it || typeof it !== "object") return "";
      const item = it as Record<string, unknown>;
      return `<li>${escapeHtml(collectText(item))}</li>`;
    })
    .join("");
  return `<${tag}>${li}</${tag}>`;
}

function collectText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return (node.content as unknown[])
      .map((c) => (c && typeof c === "object" ? collectText(c as Record<string, unknown>) : ""))
      .join("");
  }
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
