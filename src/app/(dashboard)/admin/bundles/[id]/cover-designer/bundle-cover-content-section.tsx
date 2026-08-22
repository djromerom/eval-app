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
}

// Límites del schema (CoverContentSchema en domain/cover-content.ts).
// Si los subimos también allí, hay que actualizar aquí.
const ITEMS_BEFORE_MAX = 10;
const ITEMS_AFTER_MAX = 15;
const STRING_MAX = 200;

/**
 * Sección "Contenido de portada" embebida en cover-designer (PR 4, ago 2026).
 *
 * Persiste `EvaluationBundle.coverContent` vía `saveBundleCoverContentAction`.
 * Mismo patrón que `BundleThemeSection`: strings vacíos caen al valor
 * `resolved` (que ya está colapsado a institución → DEFAULT_*), bullets
 * vacíos se filtran antes de enviar al action.
 *
 * Campos (mismo orden que en `cover-content.ts` para facilitar el review):
 *   • Texto del callout destacado
 *   • Título del bloque de instrucciones
 *   • Bullets ANTES del callout (máx 10)
 *   • Pregunta + ejemplo del bloque "¿CÓMO MARCAR?"
 *   • Etiqueta del rectángulo de ejemplo ("MARQUE ASÍ")
 *   • Bullets DESPUÉS del bloque cómo-marcar (máx 15)
 *   • Título + cuerpo del bloque "Prohibido"
 *   • Pie legal al pie de portada
 *
 * Limitación conocida: el preview iframe del cover-designer NO se actualiza
 * en tiempo real con estos cambios — el cover-context se reconstruye
 * server-side tras Guardar + reload (mismo comportamiento que el theme).
 */
export function BundleCoverContentSection({ bundleId, initial, resolved, editable }: Props) {
  const [state, formAction] = useActionState<BundleCoverContentFormState, FormData>(
    (prev, fd) => saveBundleCoverContentAction(bundleId, prev, fd),
    {},
  );
  const [resetState, resetAction] = useActionState<BundleCoverContentFormState, FormData>(
    () => resetBundleCoverContentAction(bundleId),
    {},
  );

  // --- Estado local ---
  // Para los strings: estado inicial = override del bundle si existe, si
  // no el valor `resolved` (lo que el usuario vería hoy). Cadena vacía
  // significa "sin override" y cae al resolved en runtime.
  const [calloutText, setCalloutText] = useState(initial.calloutText ?? resolved.calloutText);
  const [instructionsTitle, setInstructionsTitle] = useState(
    initial.instructionsTitle ?? resolved.instructionsTitle,
  );
  const [howToMarkQuestion, setHowToMarkQuestion] = useState(
    initial.howToMarkQuestion ?? resolved.howToMarkQuestion,
  );
  const [howToMarkExample, setHowToMarkExample] = useState(
    initial.howToMarkExample ?? resolved.howToMarkExample,
  );
  const [howToMarkExampleLabel, setHowToMarkExampleLabel] = useState(
    initial.howToMarkExampleLabel ?? resolved.howToMarkExampleLabel,
  );
  const [prohibitedTitle, setProhibitedTitle] = useState(
    initial.prohibitedTitle ?? resolved.prohibitedTitle,
  );
  const [prohibitedBody, setProhibitedBody] = useState(
    initial.prohibitedBody ?? resolved.prohibitedBody,
  );
  const [legalFooter, setLegalFooter] = useState(initial.legalFooter ?? resolved.legalFooter);

  // Para los bullets: estado es `string[]` (inputs controlados).
  // Vacío = fila vacía que se filtra al enviar. Longitud inicial =
  // max(initial.length, 1) para que siempre haya al menos una fila visible.
  const [itemsBefore, setItemsBefore] = useState<string[]>(() =>
    arrayFromBullets(initial.itemsBefore ?? resolved.itemsBefore, ITEMS_BEFORE_MAX),
  );
  const [itemsAfter, setItemsAfter] = useState<string[]>(() =>
    arrayFromBullets(initial.itemsAfter ?? resolved.itemsAfter, ITEMS_AFTER_MAX),
  );

  return (
    <form action={formAction} className="bg-card space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="font-semibold">Contenido de portada</h2>
        <p className="text-muted-foreground text-xs">
          Sobreescribe el texto institucional de la portada. Solo aplica a este cuadernillo. En
          blanco = hereda del colegio o, si el colegio no lo configuró, del DEFAULT de la
          plantilla.
        </p>
      </div>

      <fieldset className="space-y-4" disabled={!editable}>
        {/* === Bloque Instrucciones === */}
        <Section title="Bloque de instrucciones">
          <Field label="Título del bloque" hint="Si lo dejas en blanco se usa el título por defecto.">
            <Input
              name="instructionsTitle"
              value={instructionsTitle}
              onChange={(e) => setInstructionsTitle(e.target.value)}
              maxLength={80}
              placeholder={resolved.instructionsTitle}
            />
            <HeredarRow
              onClick={() => setInstructionsTitle(resolved.instructionsTitle)}
              empty={!instructionsTitle}
            />
          </Field>

          <Field
            label={`Indicaciones iniciales (máx ${ITEMS_BEFORE_MAX})`}
            hint="Aparecen ANTES del callout destacado."
          >
            <BulletsEditor
              name="itemsBefore"
              max={ITEMS_BEFORE_MAX}
              value={itemsBefore}
              onChange={setItemsBefore}
              resolved={resolved.itemsBefore}
              placeholder="Ej. Lea cada pregunta antes de responder."
            />
          </Field>

          <Field
            label="Callout destacado"
            hint="Caja con borde redondeado entre los bullets iniciales y el bloque ¿cómo marcar?."
          >
            <textarea
              name="calloutText"
              value={calloutText}
              onChange={(e) => setCalloutText(e.target.value)}
              maxLength={400}
              rows={2}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              placeholder={resolved.calloutText}
            />
            <HeredarRow
              onClick={() => setCalloutText(resolved.calloutText)}
              empty={!calloutText}
            />
          </Field>
        </Section>

        {/* === Bloque ¿Cómo marcar? === */}
        <Section title='Bloque "¿Cómo marcar en su hoja de respuestas?"'>
          <Field label="Pregunta + ejemplo" hint="Puede llevar saltos de línea.">
            <textarea
              name="howToMarkQuestion"
              value={howToMarkQuestion}
              onChange={(e) => setHowToMarkQuestion(e.target.value)}
              maxLength={400}
              rows={2}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              placeholder={resolved.howToMarkQuestion}
            />
            <HeredarRow
              onClick={() => setHowToMarkQuestion(resolved.howToMarkQuestion)}
              empty={!howToMarkQuestion}
            />
          </Field>

          <Field
            label='Etiqueta del rectángulo de ejemplo ("MARQUE ASÍ")'
            hint="Texto corto en la parte superior del rectángulo con burbujas."
          >
            <Input
              name="howToMarkExampleLabel"
              value={howToMarkExampleLabel}
              onChange={(e) => setHowToMarkExampleLabel(e.target.value)}
              maxLength={80}
              placeholder={resolved.howToMarkExampleLabel}
            />
            <HeredarRow
              onClick={() => setHowToMarkExampleLabel(resolved.howToMarkExampleLabel)}
              empty={!howToMarkExampleLabel}
            />
          </Field>

          <Field label='Texto del ejemplo ("Por ejemplo, si la opción correcta es B…")'>
            <Input
              name="howToMarkExample"
              value={howToMarkExample}
              onChange={(e) => setHowToMarkExample(e.target.value)}
              maxLength={200}
              placeholder={resolved.howToMarkExample}
            />
            <HeredarRow
              onClick={() => setHowToMarkExample(resolved.howToMarkExample)}
              empty={!howToMarkExample}
            />
          </Field>

          <Field
            label={`Indicaciones finales (máx ${ITEMS_AFTER_MAX})`}
            hint="Aparecen DESPUÉS del bloque ¿cómo marcar? (verificación, firma, entrega del material)."
          >
            <BulletsEditor
              name="itemsAfter"
              max={ITEMS_AFTER_MAX}
              value={itemsAfter}
              onChange={setItemsAfter}
              resolved={resolved.itemsAfter}
              placeholder="Ej. Verifique sus respuestas antes de entregar la hoja."
            />
          </Field>
        </Section>

        {/* === Bloque Prohibido === */}
        <Section title='Bloque "Prohibido"'>
          <Field label="Título">
            <Input
              name="prohibitedTitle"
              value={prohibitedTitle}
              onChange={(e) => setProhibitedTitle(e.target.value)}
              maxLength={80}
              placeholder={resolved.prohibitedTitle}
            />
            <HeredarRow
              onClick={() => setProhibitedTitle(resolved.prohibitedTitle)}
              empty={!prohibitedTitle}
            />
          </Field>

          <Field
            label="Cuerpo"
            hint="Justificación legal de los elementos prohibidos (dispositivos electrónicos, consultas, etc.)."
          >
            <textarea
              name="prohibitedBody"
              value={prohibitedBody}
              onChange={(e) => setProhibitedBody(e.target.value)}
              maxLength={800}
              rows={3}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              placeholder={resolved.prohibitedBody}
            />
            <HeredarRow
              onClick={() => setProhibitedBody(resolved.prohibitedBody)}
              empty={!prohibitedBody}
            />
          </Field>
        </Section>

        {/* === Pie legal === */}
        <Section title="Pie legal">
          <Field
            label="Pie de página"
            hint="Resolución rectoral, código DANE, etc. Aparece al pie de la portada."
          >
            <Input
              name="legalFooter"
              value={legalFooter}
              onChange={(e) => setLegalFooter(e.target.value)}
              maxLength={300}
              placeholder={resolved.legalFooter}
            />
            <HeredarRow
              onClick={() => setLegalFooter(resolved.legalFooter)}
              empty={!legalFooter}
            />
          </Field>
        </Section>
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
      {resetState.error ? (
        <p className="text-destructive text-sm">{resetState.error}</p>
      ) : null}
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
  value: string[];
  onChange: (next: string[]) => void;
  resolved: readonly string[];
  placeholder: string;
}

/**
 * Editor de bullets controlado. Cada fila = `<input name="<name>[]">`.
 * Strings vacíos se filtran al enviar (en el server action), no aquí:
 * conservamos las filas vacías para que el docente vea dónde añadir más.
 *
 * Si el docente llega al `max`, el botón "Añadir" se desactiva.
 */
function BulletsEditor({ name, max, value, onChange, placeholder }: BulletsEditorProps) {
  const updateRow = (i: number, v: string) => {
    const next = [...value];
    next[i] = v.slice(0, STRING_MAX);
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
            maxLength={STRING_MAX}
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
function ResetButton({ disabled, formAction }: { disabled: boolean; formAction: (fd: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={disabled || pending} formAction={formAction}>
      {pending ? "Restableciendo…" : "Restablecer al institucional"}
    </Button>
  );
}
