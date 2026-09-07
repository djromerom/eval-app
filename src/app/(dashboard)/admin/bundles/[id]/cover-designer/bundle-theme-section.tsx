"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type EvaluationTheme,
  type ResolvedTheme,
  type QuestionFontSize,
  DENSITIES,
  DENSITY_LABELS,
  QUESTION_COLUMNS,
  QUESTION_COLUMNS_LABELS,
  QUESTION_FONT_SIZES,
  QUESTION_FONT_SIZE_LABELS,
  FONT_FAMILIES,
  FONT_FAMILY_LABELS,
  SECTION_DIVIDERS,
  SECTION_DIVIDER_LABELS,
} from "@/modules/theme/domain/theme";
import { saveBundleThemeAction, type BundleThemeFormState } from "./actions";

interface Props {
  bundleId: string;
  initial: Partial<EvaluationTheme>;
  /** Tema ya colapsado con el institucional — para mostrar el "Heredar". */
  resolved: ResolvedTheme;
  /** False si el cuadernillo no está en DRAFT (no se puede editar). */
  editable: boolean;
}

/**
 * Sección "Tema de este cuadernillo" embebida en cover-designer.
 *
 * Misma forma y campos que el BundleDesignerForm de /designer/, pero SIN
 * preview iframe (cover-designer ya tiene el suyo mostrando la portada).
 * Constantes y labels vienen del módulo theme para no duplicar.
 *
 * Limitación conocida: el preview iframe del cover-designer sigue
 * mostrando la portada con institution.theme. Para que reaccione al
 * bundle.theme hay que extender CoverContext — fuera del alcance.
 *
 * NO incluye los campos "Mostrar logo" ni "Bloque intro" porque no
 * aparecen en la captura que aprobó el docente; viven solo en /designer/.
 */
export function BundleThemeSection({ bundleId, initial, resolved, editable }: Props) {
  const [state, formAction] = useActionState<BundleThemeFormState, FormData>(
    (prev, fd) => saveBundleThemeAction(bundleId, prev, fd),
    {},
  );

  const safeInitial = initial ?? {};
  const [primary, setPrimary] = useState(safeInitial.primary ?? resolved.primary);
  const [fontFamily, setFontFamily] = useState(safeInitial.fontFamily ?? resolved.fontFamily);
  const [density, setDensity] = useState(safeInitial.density ?? resolved.density);
  const [questionColumns, setQuestionColumns] = useState(
    safeInitial.questionColumns ?? resolved.questionColumns,
  );
  // Tamaño de fuente de los items (sep 2026). Resuelto = heredado del tema
  // institucional; override = valor del bundle (si el admin lo guardó).
  // El default global es 10pt (coincide con `.booklet { font-size: 10pt }`).
  const [questionFontSize, setQuestionFontSize] = useState<QuestionFontSize>(
    safeInitial.questionFontSize ?? resolved.questionFontSize,
  );
  const [footerText, setFooterText] = useState(safeInitial.footerText ?? resolved.footerText);
  const [coverSubtitle, setCoverSubtitle] = useState(
    safeInitial.coverSubtitle ?? resolved.coverSubtitle,
  );
  const [sectionDivider, setSectionDivider] = useState(
    safeInitial.sectionDivider ?? resolved.sectionDivider,
  );

  return (
    <form action={formAction} className="bg-card space-y-3 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Tema de este cuadernillo</h2>
        <p className="text-muted-foreground text-xs">
          Sobreescribe el tema institucional. Solo aplica a este cuadernillo. En blanco = hereda del
          colegio.
        </p>
      </div>

      <fieldset className="space-y-3" disabled={!editable}>
        {/* Color primario */}
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

        {/* Tipografía */}
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

        {/* Densidad */}
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

        {/* Columnas de preguntas */}
        <Field label="Columnas de preguntas">
          <select
            name="questionColumns"
            value={questionColumns}
            onChange={(e) => setQuestionColumns(Number(e.target.value) as typeof questionColumns)}
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

        {/* Tamaño de fuente de los items (sep 2026). Afecta al cuerpo de las
            preguntas y al título/contenido del contexto (.questions-flow) —
            NO a la portada, ni a la hoja de respuestas, ni a la tabla de
            competencias, ni al "RESPONDA LAS PREGUNTAS..." (que mantiene su
            10pt por ser instrucción estructural). */}
        <Field label="Tamaño de fuente de los items">
          <div className="flex items-center gap-2">
            <select
              name="questionFontSize"
              value={questionFontSize}
              onChange={(e) => setQuestionFontSize(Number(e.target.value) as QuestionFontSize)}
              className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            >
              {QUESTION_FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {QUESTION_FONT_SIZE_LABELS[s]}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setQuestionFontSize(resolved.questionFontSize)}
            >
              Heredar
            </Button>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            Default 10pt (igual que el PDF de referencia). Escala el cuerpo de las preguntas y el
            contexto. No afecta a la portada ni a la hoja de respuestas.
          </p>
        </Field>

        {/* Pie de página */}
        <Field label="Pie de página">
          <Input
            name="footerText"
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            maxLength={200}
          />
        </Field>

        {/* Subtítulo de portada */}
        <Field label="Subtítulo de portada (período / fecha / grado)">
          <Input
            name="coverSubtitle"
            value={coverSubtitle}
            onChange={(e) => setCoverSubtitle(e.target.value)}
            maxLength={200}
            placeholder="Grado Undécimo · Periodo I · 2026"
          />
        </Field>

        {/* Separador entre secciones */}
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
      </fieldset>

      {!editable ? (
        <p className="text-muted-foreground text-xs">
          El cuadernillo no está en BORRADOR. Solo se puede editar el tema mientras esté en
          borrador.
        </p>
      ) : null}

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? (
        <p className="text-success text-sm">Tema guardado. Vista previa actualizada.</p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <SubmitButton disabled={!editable} />
      </div>
    </form>
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
