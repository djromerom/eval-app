"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CoverContent,
  type ResolvedCoverContent,
} from "@/modules/bundle-cover/domain/cover-content";
import {
  type CoverContentField,
  type ExtractedFields,
  FIELD_META,
  groupFieldsByBlock,
} from "@/modules/bundle-cover/domain/template-fields";
import {
  resetBundleCoverContentAction,
  saveBundleCoverContentAction,
  type BundleCoverContentFormState,
} from "./actions";

interface Props {
  bundleId: string;
  /** Override actual del compendio (puede ser {} si no hay override). */
  initial: Partial<CoverContent>;
  /** Contenido ya colapsado (bundle ⊕ institucional ⊕ DEFAULT). Se usa para
   *  mostrar los valores "actuales" en cada campo y el botón Heredar. */
  resolved: ResolvedCoverContent;
  /** False si el cuadernillo no está en DRAFT (no se puede editar). */
  editable: boolean;
  /**
   * Campos del schema que la plantilla activa realmente referencia (PR 5).
   * El form se genera dinámicamente a partir de este set: si la plantilla
   * no usa `{{cover.callout.text}}`, no aparece un textarea para
   * `calloutText` (lo que el docente escriba no se renderizaría en el PDF).
   * `hasAny=false` muestra un mensaje de "plantilla sin contenido editable"
   * en lugar del form.
   */
  fields: ExtractedFields;
}

// ===========================================================================
// Sección "Contenido de portada" embebida en cover-designer (PR 4, ago 2026).
//
// Persiste `EvaluationBundle.coverContent` vía `saveBundleCoverContentAction`.
// Mismo patrón que `BundleThemeSection`: strings vacíos caen al valor
// `resolved` (que ya está colapsado a institución → DEFAULT_*), bullets
// vacíos se filtran antes de enviar al action.
//
// Desde PR 5 (ago 2026) el form es template-driven: los inputs que pinta
// son solo los que la plantilla activa efectivamente referencia. Si la
// plantilla activa es `primaria-v1` (que solo usa `institution.legalFooter`
// del schema), solo aparece el bloque "Pie legal". Si el docente cambia
// a `secundaria-v1`, aparecen los bloques de instrucciones, ¿cómo marcar?
// y prohibido.
//
// Limitación conocida: el preview iframe del cover-designer NO se actualiza
// en tiempo real con estos cambios — el cover-context se reconstruye
// server-side tras Guardar + reload (mismo comportamiento que el theme).
// ===========================================================================
export function BundleCoverContentSection({
  bundleId,
  initial,
  resolved,
  editable,
  fields,
}: Props) {
  const [state, formAction] = useActionState<BundleCoverContentFormState, FormData>(
    (prev, fd) => saveBundleCoverContentAction(bundleId, prev, fd),
    {},
  );
  const [resetState, resetAction] = useActionState<BundleCoverContentFormState, FormData>(
    () => resetBundleCoverContentAction(bundleId),
    {},
  );

  // --- Estado local ---
  // Strings: por cada campo que la plantilla usa, guardamos el override
  // actual del bundle o el valor `resolved` (lo que el usuario vería hoy).
  // Cadena vacía = "sin override" y cae al resolved en runtime.
  const [strings, setStrings] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.strings.map((f) => [f, initialStringFor(f, initial, resolved)])),
  );
  // Arrays: por cada campo array que la plantilla usa, el editor de bullets
  // controlado (un string[] con al menos un slot vacío para "+ Añadir").
  const [arrays, setArrays] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      fields.arrays.map((f) => {
        const meta = FIELD_META[f];
        return [f, arrayFromBullets(initialArrayFor(f, initial, resolved), meta.arrayMax ?? 10)];
      }),
    ),
  );

  if (!fields.hasAny) {
    return (
      <div className="bg-card space-y-3 rounded-xl border p-5">
        <div>
          <h2 className="font-semibold">Contenido de portada</h2>
          <p className="text-muted-foreground text-xs">
            Esta plantilla no usa contenido de portada editable. Para personalizar los textos
            (callout, instrucciones, ¿cómo marcar?, etc.) cambia a una variante como{" "}
            <span className="font-mono">secundaria-v1</span> o sube tu propio HTML que referencie
            variables <code>{`{{cover.*}}`}</code>.
          </p>
        </div>
      </div>
    );
  }

  const blocks = groupFieldsByBlock(fields);

  return (
    <form action={formAction} className="bg-card space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Contenido de portada</h2>
        <p className="text-muted-foreground text-xs">
          Sobreescribe el texto institucional de la portada. Solo aplica a este cuadernillo. En
          blanco = hereda del colegio o, si el colegio no lo configuró, del DEFAULT de la plantilla.
        </p>
      </div>

      <fieldset className="space-y-4" disabled={!editable}>
        {blocks.map((block) => (
          <Section key={block.block} title={block.label}>
            {block.fields.map((field) => {
              const meta = FIELD_META[field];
              if (fields.arrays.includes(field)) {
                return (
                  <Field
                    key={field}
                    label={`${meta.label} (máx ${meta.arrayMax ?? 10})`}
                    hint={meta.hint}
                  >
                    <BulletsEditor
                      name={field}
                      max={meta.arrayMax ?? 10}
                      maxLength={meta.maxLength}
                      value={arrays[field] ?? [""]}
                      onChange={(next) => setArrays({ ...arrays, [field]: next })}
                      placeholder={meta.placeholder ?? ""}
                    />
                  </Field>
                );
              }
              return (
                <Field key={field} label={meta.label} hint={meta.hint}>
                  <DynamicInput
                    field={field}
                    meta={meta}
                    value={strings[field] ?? ""}
                    resolvedValue={initialStringFor(field, {}, resolved)}
                    onChange={(v) => setStrings({ ...strings, [field]: v })}
                  />
                </Field>
              );
            })}
          </Section>
        ))}
      </fieldset>

      {!editable ? (
        <p className="text-muted-foreground text-xs">
          El cuadernillo no está en BORRADOR. Solo se puede editar el contenido de portada mientras
          esté en borrador.
        </p>
      ) : null}

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.success ? (
        <p className="text-success text-sm">Contenido guardado. Vista previa actualizada.</p>
      ) : null}
      {resetState.error ? <p className="text-destructive text-sm">{resetState.error}</p> : null}
      {resetState.success ? (
        <p className="text-success text-sm">Override eliminado. Vuelve al institucional.</p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <SubmitButton disabled={!editable} />
        <ResetButton disabled={!editable} formAction={resetAction} />
      </div>
    </form>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Lee el override del bundle para un campo string; si no, el resolved. */
function initialStringFor(
  f: CoverContentField,
  initial: Partial<CoverContent>,
  resolved: ResolvedCoverContent,
): string {
  const v = initial[f];
  if (typeof v === "string") return v;
  const r = resolved[f];
  return typeof r === "string" ? r : "";
}

/** Lee el override del bundle para un campo array; si no, el resolved. */
function initialArrayFor(
  f: CoverContentField,
  initial: Partial<CoverContent>,
  resolved: ResolvedCoverContent,
): readonly string[] {
  const v = initial[f];
  if (Array.isArray(v)) return v;
  const r = resolved[f];
  return Array.isArray(r) ? r : [];
}

/**
 * Convierte un array de bullets (potencialmente readonly) en un array mutable
 * con al menos un slot vacío al final (para que el editor siempre tenga
 * un "+ Añadir" visible). Trunca al `max` del schema.
 */
function arrayFromBullets(src: readonly string[] | undefined, max: number): string[] {
  const arr = (src ?? []).slice(0, max).map((s) => s);
  if (arr.length < max) arr.push("");
  return arr;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </label>
  );
}

/**
 * Render del input controlado para un campo string — usa `<textarea>` si la
 * metadata marca `multiline`, o `<Input>` si no. Incluye el botón Heredar
 * (PR 4): si el docente escribió algo custom, le permite volver al valor
 * resuelto (institucional / DEFAULT).
 */
function DynamicInput({
  field,
  meta,
  value,
  resolvedValue,
  onChange,
}: {
  field: CoverContentField;
  meta: (typeof FIELD_META)[CoverContentField];
  value: string;
  resolvedValue: string;
  onChange: (v: string) => void;
}) {
  if (meta.multiline) {
    return (
      <>
        <textarea
          name={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={meta.maxLength}
          rows={meta.maxLength > 400 ? 3 : 2}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          placeholder={resolvedValue}
        />
        <HeredarRow onClick={() => onChange(resolvedValue)} empty={!value} />
      </>
    );
  }
  return (
    <>
      <Input
        name={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={meta.maxLength}
        placeholder={resolvedValue}
      />
      <HeredarRow onClick={() => onChange(resolvedValue)} empty={!value} />
    </>
  );
}

function HeredarRow({ onClick, empty }: { onClick: () => void; empty: boolean }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span>{empty ? "Hereda del institucional." : "Valor custom."}</span>
      {!empty ? (
        <Button type="button" variant="ghost" size="sm" onClick={onClick}>
          Heredar
        </Button>
      ) : null}
    </div>
  );
}

interface BulletsEditorProps {
  name: string;
  max: number;
  maxLength: number;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}

/**
 * Editor de bullets controlado. Cada fila = `<input name="<name>[]">`.
 * Strings vacíos se filtran al enviar (en el server action), no aquí:
 * conservamos las filas vacías para que el docente vea dónde añadir más.
 *
 * Si el docente llega al `max`, el botón "Añadir" se desactiva.
 */
function BulletsEditor({ name, max, maxLength, value, onChange, placeholder }: BulletsEditorProps) {
  const updateRow = (i: number, v: string) => {
    const next = [...value];
    next[i] = v.slice(0, maxLength);
    onChange(next);
  };
  const removeRow = (i: number) => {
    const next = value.filter((_, idx) => idx !== i);
    if (next.length === 0) next.push("");
    onChange(next);
  };
  const addRow = () => {
    if (value.length >= max) return;
    onChange([...value, ""]);
  };

  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            name={`${name}[]`}
            value={row}
            onChange={(e) => updateRow(i, e.target.value)}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={`Indicación ${i + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => removeRow(i)}
            aria-label={`Eliminar indicación ${i + 1}`}
          >
            ×
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={value.length >= max}
        >
          + Añadir indicación
        </Button>
        <span className="text-muted-foreground text-xs">
          {value.filter((v) => v.trim().length > 0).length}/{max} usadas
        </span>
      </div>
    </div>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Guardando…" : "Guardar contenido"}
    </Button>
  );
}

/**
 * El botón de reset usa `formAction` (pasado por el caller) para evitar
 * anidar forms (HTML no permite forms anidadas). El caller lo conecta al
 * `resetAction` del `useActionState` de `resetBundleCoverContentAction`.
 */
function ResetButton({
  disabled,
  formAction,
}: {
  disabled: boolean;
  formAction: (fd: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={disabled || pending} formAction={formAction}>
      {pending ? "Restableciendo…" : "Restablecer al institucional"}
    </Button>
  );
}
