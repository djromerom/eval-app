"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "@/modules/theme/domain/theme";
import { type CoverContent } from "@/modules/bundle-cover/domain/cover-content";
import {
  type CoverContentField,
  type ExtractedFields,
  FIELD_META,
  groupFieldsByBlock,
} from "@/modules/bundle-cover/domain/template-fields";
import {
  STUDIO_BLOCK_IDS,
  type StudioBlockId,
  type StudioBlockState,
} from "@/modules/bundle-cover/domain/block-sections";
import { saveCoverStudioAction, type CoverStudioFormState } from "./actions";

interface Props {
  bundleId: string;
  bundleName: string;
  source: "BUILT_IN" | "OVERRIDE";
  templateKey: string;
  /** Estado inicial de visibilidad por bloque (identificado desde el HTML). */
  initialBlockState: StudioBlockState;
  initialTheme: Partial<EvaluationTheme>;
  resolvedTheme: ResolvedTheme;
  initialCoverContent: Partial<CoverContent>;
  coverContentFields: ExtractedFields;
  previewHtml: string;
  editable: boolean;
}

// ===========================================================================
// Cover Studio — form unificado de estilos + contenido + toggles (ago 2026).
// ===========================================================================
//
// Una sola action (`saveCoverStudioAction`) persiste TODO en un click.
// Cada card tiene un nombre de campo con prefijo (`theme.X`, `content.X`,
// `block.X`) para que el server action pueda desambiguar las tres fuentes.
//
// El Studio NO edita HTML crudo — ese flujo vive en `/cover-designer`. Aquí
// el docente aplica un preset, ajusta colores/fuentes, prende/apaga bloques
// y edita el copy. La preview del iframe muestra el render server-side tras
// Guardar (mismo pipeline que cover-designer).
//
// Layout 2 columnas (xl+):
//   - Izquierda (1fr, max 720px): 4 cards (Tema visual, Colores y
//     tipografía, Bloques visibles, Contenido) + botón Guardar.
//   - Derecha (1fr): iframe con preview del HTML efectivo.
// ===========================================================================
export function CoverStudioForm({
  bundleId,
  bundleName,
  source,
  templateKey,
  initialBlockState,
  initialTheme,
  resolvedTheme,
  initialCoverContent,
  coverContentFields,
  previewHtml,
  editable,
}: Props) {
  const [state, formAction] = useActionState<CoverStudioFormState, FormData>(
    (prev, fd) => saveCoverStudioAction(bundleId, prev, fd),
    {},
  );

  // Theme state
  const [primary, setPrimary] = useState(initialTheme.primary ?? resolvedTheme.primary);
  const [fontFamily, setFontFamily] = useState(initialTheme.fontFamily ?? resolvedTheme.fontFamily);
  const [density, setDensity] = useState(initialTheme.density ?? resolvedTheme.density);
  const [questionColumns, setQuestionColumns] = useState(
    initialTheme.questionColumns ?? resolvedTheme.questionColumns,
  );
  const [footerText, setFooterText] = useState(initialTheme.footerText ?? resolvedTheme.footerText);
  const [coverSubtitle, setCoverSubtitle] = useState(
    initialTheme.coverSubtitle ?? resolvedTheme.coverSubtitle,
  );
  const [sectionDivider, setSectionDivider] = useState(
    initialTheme.sectionDivider ?? resolvedTheme.sectionDivider,
  );

  // Block state — toggleable en la UI
  const [blocks, setBlocks] = useState<StudioBlockState>(initialBlockState);

  // Cover content state (strings)
  const [coverContentStrings, setCoverContentStrings] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of coverContentFields.strings) {
      const v = (initialCoverContent as Record<string, unknown>)[f];
      out[f] = typeof v === "string" ? v : "";
    }
    return out;
  });

  // Cover content state (arrays)
  const [coverContentArrays, setCoverContentArrays] = useState<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    for (const f of coverContentFields.arrays) {
      const v = (initialCoverContent as Record<string, unknown>)[f];
      out[f] = Array.isArray(v) ? v.map(String) : [""];
    }
    return out;
  });

  // Preset: aplica un set de theme values a la vez (solo afecta theme state).
  type Preset = "classic" | "modern" | "compact" | "minimal";
  const applyPreset = (preset: Preset) => {
    const presets: Record<Preset, Partial<EvaluationTheme>> = {
      classic: {
        primary: "#0A4FA8",
        fontFamily: "serif",
        density: "normal",
        questionColumns: 1,
        sectionDivider: "line",
      },
      modern: {
        primary: "#0A4FA8",
        fontFamily: "sans",
        density: "airy",
        questionColumns: 1,
        sectionDivider: "line",
      },
      compact: {
        primary: "#0A4FA8",
        fontFamily: "sans",
        density: "compact",
        questionColumns: 2,
        sectionDivider: "dots",
      },
      minimal: {
        primary: "#475569",
        fontFamily: "sans",
        density: "airy",
        questionColumns: 1,
        sectionDivider: "line",
      },
    };
    const p = presets[preset];
    if (p.primary) setPrimary(p.primary);
    if (p.fontFamily) setFontFamily(p.fontFamily);
    if (p.density) setDensity(p.density);
    if (p.questionColumns) setQuestionColumns(p.questionColumns);
    if (p.sectionDivider) setSectionDivider(p.sectionDivider);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/admin/bundles/${bundleId}`} className="text-muted-foreground hover:underline">
          ← Volver al cuadernillo
        </Link>
        <Link
          href={`/admin/bundles/${bundleId}/cover-designer`}
          className="text-muted-foreground hover:underline"
        >
          ← Volver al HTML
        </Link>
        <Link
          href={`/print/bundle/${bundleId}`}
          target="_blank"
          className="text-muted-foreground hover:underline"
        >
          Abrir cuadernillo en pestaña nueva ↗
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
              source === "OVERRIDE"
                ? "border-amber-200 bg-amber-100 text-amber-900"
                : "border-slate-200 bg-slate-100 text-slate-700"
            }`}
          >
            {source === "OVERRIDE" ? "OVERRIDE" : "Built-in"}
          </span>
          <span className="bg-muted rounded-md px-2 py-0.5 font-mono text-xs">{templateKey}</span>
        </div>
      </div>

      <form action={formAction} className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        {/* ============ Columna izquierda: cards ============ */}
        <div className="space-y-4">
          {/* Card 1: Tema visual (presets) */}
          <section className="bg-card space-y-3 rounded-xl border p-5">
            <header>
              <h2 className="font-semibold">Tema visual</h2>
              <p className="text-muted-foreground text-xs">
                Empieza con un preset. Después ajusta fino en la siguiente tarjeta.
              </p>
            </header>
            <fieldset className="space-y-2" disabled={!editable}>
              <div className="grid grid-cols-2 gap-2">
                <PresetButton
                  name="Clásico"
                  description="Azul primario · serif · normal"
                  onClick={() => applyPreset("classic")}
                />
                <PresetButton
                  name="Moderno"
                  description="Azul primario · sans · airy"
                  onClick={() => applyPreset("modern")}
                />
                <PresetButton
                  name="Compacto"
                  description="Azul primario · sans · compacto"
                  onClick={() => applyPreset("compact")}
                />
                <PresetButton
                  name="Minimalista"
                  description="Gris neutro · sans · airy"
                  onClick={() => applyPreset("minimal")}
                />
              </div>
            </fieldset>
          </section>

          {/* Card 2: Colores y tipografía */}
          <section className="bg-card space-y-3 rounded-xl border p-5">
            <header>
              <h2 className="font-semibold">Colores y tipografía</h2>
              <p className="text-muted-foreground text-xs">
                Sobreescribe el tema institucional. Solo aplica a este cuadernillo.
              </p>
            </header>
            <fieldset className="space-y-3" disabled={!editable}>
              <Field label="Color primario">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    name="theme.primary"
                    value={primary}
                    onChange={(e) => setPrimary(e.target.value)}
                    className="h-9 w-14 cursor-pointer rounded border"
                    aria-label="Selector de color primario"
                  />
                  <Input
                    value={primary}
                    onChange={(e) => setPrimary(e.target.value)}
                    pattern="#[0-9a-fA-F]{6}"
                    maxLength={7}
                    className="w-28"
                    aria-label="Hex del color primario"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrimary(resolvedTheme.primary)}
                  >
                    Heredar
                  </Button>
                </div>
              </Field>

              <Field label="Tipografía">
                <select
                  name="theme.fontFamily"
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
                  name="theme.density"
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
                  name="theme.questionColumns"
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
                  A dos columnas, las preguntas con imagen o tabla siguen ocupando el ancho
                  completo.
                </p>
              </Field>

              <Field label="Pie de página">
                <Input
                  name="theme.footerText"
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value)}
                  maxLength={200}
                />
              </Field>

              <Field label="Subtítulo de portada (período / fecha / grado)">
                <Input
                  name="theme.coverSubtitle"
                  value={coverSubtitle}
                  onChange={(e) => setCoverSubtitle(e.target.value)}
                  maxLength={200}
                  placeholder="Grado Undécimo · Periodo I · 2026"
                />
              </Field>

              <Field label="Separador entre secciones">
                <select
                  name="theme.sectionDivider"
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
            </fieldset>
          </section>

          {/* Card 3: Bloques visibles */}
          <section className="bg-card space-y-3 rounded-xl border p-5">
            <header>
              <h2 className="font-semibold">Bloques visibles</h2>
              <p className="text-muted-foreground text-xs">
                Enciende o apaga cada bloque de la portada sin tocar el HTML. El cambio se aplica
                como un toggle dentro del HTML efectivo al guardar.
              </p>
            </header>
            <fieldset className="space-y-2" disabled={!editable}>
              {STUDIO_BLOCK_IDS.map((id) => (
                <BlockToggle
                  key={id}
                  id={id}
                  checked={blocks[id]}
                  onChange={(v) => setBlocks((b) => ({ ...b, [id]: v }))}
                />
              ))}
            </fieldset>
          </section>

          {/* Card 4: Contenido */}
          <section className="bg-card space-y-4 rounded-xl border p-5">
            <header>
              <h2 className="font-semibold">Contenido</h2>
              <p className="text-muted-foreground text-xs">
                Texto que se inyecta en los placeholders Mustache del HTML. Lo que dejes en blanco
                cae al valor institucional / DEFAULT.
              </p>
            </header>

            {!coverContentFields.hasAny ? (
              <p className="text-muted-foreground text-sm">
                Esta plantilla no usa contenido de portada editable.
              </p>
            ) : (
              <fieldset className="space-y-4" disabled={!editable}>
                {groupFieldsByBlock(coverContentFields).map((block) => (
                  <div key={block.block} className="space-y-3">
                    <h3 className="text-sm font-medium">{block.label}</h3>
                    {block.fields.map((field) => (
                      <ContentField
                        key={field}
                        field={field}
                        strings={coverContentStrings}
                        setStrings={setCoverContentStrings}
                        arrays={coverContentArrays}
                        setArrays={setCoverContentArrays}
                      />
                    ))}
                  </div>
                ))}
              </fieldset>
            )}
          </section>

          {!editable ? (
            <p className="text-muted-foreground text-xs">
              El cuadernillo no está en BORRADOR. Solo se pueden editar estilos y contenido mientras
              esté en borrador.
            </p>
          ) : null}

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.success ? (
            <p className="text-success text-sm">
              Estilos y contenido guardados. Vista previa actualizada.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <SubmitButton disabled={!editable} />
          </div>

          <div className="text-muted-foreground text-xs">
            Cuadernillo: <strong>{bundleName}</strong>
          </div>
        </div>

        {/* ============ Columna derecha: preview ============ */}
        <div className="bg-muted/30 rounded-xl border p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Vista previa de la portada</h3>
            <span className="text-muted-foreground text-xs">
              Renderizada con Mustache + DOMPurify · fuente: {source}
            </span>
          </div>
          <iframe
            title="Vista previa del Cover Studio"
            srcDoc={previewHtml}
            className="h-[1600px] w-full rounded border bg-white"
            sandbox=""
          />
        </div>
      </form>
    </>
  );
}

// ===========================================================================
// Sub-componentes
// ===========================================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function PresetButton({
  name,
  description,
  onClick,
}: {
  name: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:border-primary rounded-lg border p-3 text-left text-sm transition-colors"
    >
      <div className="font-medium">{name}</div>
      <div className="text-muted-foreground text-xs">{description}</div>
    </button>
  );
}

const BLOCK_LABELS: Record<StudioBlockId, { label: string; hint?: string }> = {
  itemsBefore: { label: "Instrucciones iniciales (bullets antes del callout)" },
  callout: { label: "Callout destacado" },
  howToMark: { label: "¿Cómo marcar en su hoja de respuestas?" },
  itemsAfter: { label: "Indicaciones finales (después de ¿cómo marcar?)" },
  prohibited: { label: "Prohibido" },
  legalFooter: { label: "Pie legal" },
};

function BlockToggle({
  id,
  checked,
  onChange,
}: {
  id: StudioBlockId;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const meta = BLOCK_LABELS[id];
  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        name={`block.${id}`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <span className="text-sm">
        <span className="font-medium">{meta.label}</span>
        {meta.hint ? (
          <span className="text-muted-foreground block text-xs">{meta.hint}</span>
        ) : null}
      </span>
    </label>
  );
}

function ContentField({
  field,
  strings,
  setStrings,
  arrays,
  setArrays,
}: {
  field: CoverContentField;
  strings: Record<string, string>;
  setStrings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  arrays: Record<string, string[]>;
  setArrays: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
}) {
  const meta = FIELD_META[field];
  if (meta.arrayMax !== undefined) {
    const value = arrays[field] ?? [""];
    return (
      <Field label={meta.label}>
        {meta.hint ? <p className="text-muted-foreground text-xs">{meta.hint}</p> : null}
        <div className="space-y-1">
          {value.map((item, i) => (
            <div key={i} className="flex gap-1">
              <Input
                name={`content.${field}`}
                value={item}
                onChange={(e) =>
                  setArrays((prev) => ({
                    ...prev,
                    [field]: value.map((v, j) => (j === i ? e.target.value : v)),
                  }))
                }
                maxLength={meta.maxLength}
                placeholder={meta.placeholder}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setArrays((prev) => ({
                    ...prev,
                    [field]: value.filter((_, j) => j !== i),
                  }))
                }
                disabled={value.length <= 1}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setArrays((prev) => ({ ...prev, [field]: [...value, ""] }))}
          disabled={value.length >= meta.arrayMax}
        >
          + Agregar indicación
        </Button>
      </Field>
    );
  }
  const value = strings[field] ?? "";
  return (
    <Field label={meta.label}>
      {meta.hint ? <p className="text-muted-foreground text-xs">{meta.hint}</p> : null}
      {meta.multiline ? (
        <textarea
          name={`content.${field}`}
          value={value}
          onChange={(e) => setStrings((prev) => ({ ...prev, [field]: e.target.value }))}
          maxLength={meta.maxLength}
          rows={3}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
      ) : (
        <Input
          name={`content.${field}`}
          value={value}
          onChange={(e) => setStrings((prev) => ({ ...prev, [field]: e.target.value }))}
          maxLength={meta.maxLength}
        />
      )}
    </Field>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Guardando…" : "💾 Guardar estilos"}
    </Button>
  );
}
