"use client";

import type { RefObject } from "react";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Info } from "lucide-react";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { isTipTapEmpty } from "@/components/editor/rich-text-empty";
import { addQuestionAction, updateQuestionAction } from "./actions";
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  ANSWER_KEYS_ORDER,
} from "@/modules/evaluations/domain/evaluation";

const SOLO_OPTIONS = [
  { value: "", label: "Nivel SOLO (opcional)" },
  { value: "UNI_ESTRUCTURAL", label: "Uni-estructural" },
  { value: "MULTIESTRUCTURAL", label: "Multiestructural" },
  { value: "RELACIONAL", label: "Relacional" },
  { value: "ABSTRACTO_EXTENDIDO", label: "Abstracto extendido" },
];

const DEFAULT_COUNT = MAX_OPTIONS; // 4 por defecto

function SubmitButton({ editing, createLabel }: { editing: boolean; createLabel: string }) {
  const { pending } = useFormStatus();
  const label = editing ? "Guardar cambios" : createLabel;
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : label}
    </Button>
  );
}

/**
 * Texto plano de una opción para precargar su `<input>`.
 *
 * Las opciones creadas desde este formulario se guardan como string, pero las
 * importadas del banco pueden venir como documento TipTap. Se recorre el JSON
 * en vez de reusar `richTextToPlain` de `editor/render` para no arrastrar
 * `@tiptap/html` + KaTeX al bundle del cliente.
 */
function plainOption(initial: QuestionInitialValues | undefined, key: string): string | undefined {
  if (!initial) return undefined;
  const value = initial.options.find((o) => o.key === key)?.text;
  return toPlain(value);
}

function toPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const node = value as { text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) return node.content.map(toPlain).join("");
  return "";
}

/** Datos de la pregunta que se está editando. Ausente = alta. */
export interface QuestionInitialValues {
  id: string;
  text: unknown;
  options: { key: string; text: unknown }[];
  correctAnswer: string;
  justification?: string | null;
  weight?: number;
  soloLevel?: string | null;
  menComponent?: string | null;
  competency?: string | null;
}

/** Editor estructurado por pregunta (§3.3 v2.0): enunciado + N opciones + correcta + metadatos.
 *
 *  El usuario puede ajustar el número de opciones entre MIN_OPTIONS y
 *  MAX_OPTIONS con los botones +/−. Al quitar la opción marcada como
 *  correcta, el cursor salta automáticamente a la primera visible.
 *  El tope MAX_OPTIONS está acotado por la hoja de respuestas
 *  institucional (plantilla ICFES) que solo tiene columnas A–D.
 *
 *  Los valores de `defaultOptions` y `maxOptions` vienen del .env
 *  (EVAL_DEFAULT_OPTIONS y EVAL_MAX_OPTIONS) inyectados por el
 *  server component padre. Permiten a la institución bajar el
 *  rango sin tocar código. El tope absoluto sigue siendo MAX_OPTIONS=8
 *  (la librería solo conoce claves A–H).
 */
export function QuestionForm({
  evaluationId,
  sectionId,
  defaultOptions = DEFAULT_COUNT,
  maxOptions = MAX_OPTIONS,
  initial,
  onDone,
  createLabel = "Agregar pregunta",
  extraActions,
  overrideAction,
  formRef,
  clearCorrectAfterSave = false,
}: {
  evaluationId: string;
  /** Puede ser vacío cuando la evaluación aún no tiene secciones: el
   *  `overrideAction` del editor unificado crea la sección justo antes
   *  de invocar `addQuestionAction`. Sin esto, el form no podría
   *  renderizarse al cargar una evaluación recién creada. */
  sectionId?: string;
  defaultOptions?: number;
  maxOptions?: number;
  /** Si viene, el formulario edita esa pregunta en vez de crear una nueva. */
  initial?: QuestionInitialValues;
  /** Se invoca tras guardar con éxito.
   *
   * Recibe `info?.close === true` cuando el submitter del form fue un botón
   * con `data-close-on-save="true"` (p.ej. "Guardar y cerrar" en el editor
   * unificado). En ese caso, además, NO reseteamos los inputs — el padre
   * cerrará el card y los inputs se desmontan. Si la vista solo quiere
   * ignorar el flag, el callback sigue siendo válido como `() => void`.
   */
  onDone?: (info?: { close?: boolean }) => void;
  /** Etiqueta del botón de submit en modo creación. Default: "Agregar pregunta".
   *  Las vistas que quieran otro wording (p.ej. "Agregar enunciado" en el
   *  editor unificado) lo pasan por aquí sin tocar a las demás. */
  createLabel?: string;
  /** Acciones extra que se renderizan a la IZQUIERDA del submit, en la misma
   *  fila. Lo usa el editor unificado para poner "Nuevo contexto" al lado
   *  de "Agregar enunciado". Las otras vistas lo dejan `undefined`. */
  extraActions?: React.ReactNode;
  /** Si se pasa, REEMPLAZA el action interno del form. El editor unificado
   *  lo usa para orquestar contexto + pregunta en una sola invocación
   *  (p.ej. "Agregar enunciado" crea/renombra la sección Y guarda el ítem
   *  en el mismo click). El callback recibe el FormData del form y debe
   *  retornar el AdminFormState que se reflejará en `state`. */
  overrideAction?: (formData: FormData) => Promise<AdminFormState>;
  /** Ref externo al <form>. Si viene, el padre puede disparar
   *  `formRef.current?.requestSubmit()` programáticamente (p.ej. el botón
   *  "Nuevo contexto" del editor unificado, que está en otro <form> y
   *  necesita reutilizar el submit de este). Si no viene, se usa el ref
   *  interno (que ya usaba `formRef.current?.reset()` en `onDone`). */
  formRef?: RefObject<HTMLFormElement | null>;
  /** Tras un guardado exitoso en modo creación, en vez de auto-marcar la
   *  primera opción visible como CLAVE (comportamiento por defecto), deja
   *  la CLAVE sin seleccionar para forzar al docente a elegir una en la
   *  próxima iteración (ago 2026). El editor unificado lo pasa `true` para
   *  los flujos "Agregar enunciado" y "Nuevo contexto" — la semántica de
   *  ambos es "ya guardé un ítem, quiero que la siguiente pregunta me
   *  obligue a pensar la CLAVE de nuevo". En edición no aplica (el form
   *  no se resetea tras guardar). */
  clearCorrectAfterSave?: boolean;
}) {
  const editing = initial !== undefined;
  // Si el padre pasó un overrideAction (p.ej. el editor unificado) lo
  // invocamos en lugar del action interno (add/updateQuestionAction). Lo
  // hacemos DENTRO del useActionState para que `state` se actualice con el
  // resultado del override y el useEffect de abajo dispare onDone igual que
  // en el flujo normal. La firma `(prev, fd) => Promise<state>` es la que
  // espera useActionState; el padre recibe solo el FormData y devuelve el
  // AdminFormState resultante.
  const [state, formAction] = useActionState<AdminFormState, FormData>(async (prev, fd) => {
    if (overrideAction) return overrideAction(fd);
    return editing ? updateQuestionAction(prev, fd) : addQuestionAction(prev, fd);
  }, {});
  const [optionCount, setOptionCount] = useState<number>(initial?.options.length ?? defaultOptions);
  // "" = ninguna opción marcada todavía. Para creación partimos sin clave
  // para forzar al docente a elegir una (ago 2026); para edición respetamos
  // la clave existente. Si arranca vacía, el submit queda bloqueado con un
  // mensaje claro hasta que se marque alguna.
  const [correct, setCorrect] = useState<string>(initial?.correctAnswer ?? "");
  const [resetKey, setResetKey] = useState(0);
  // Errores de validación del cliente (no del servidor). El servidor igual
  // revalida pero queremos feedback inmediato sin round-trip. Se prioriza
  // sobre `state.error` (server) cuando está presente.
  const [clientError, setClientError] = useState<string | null>(null);
  // ago 2026: el error de "falta CLAVE" se muestra como AlertDialog modal
  // (no como <p> inline) para que el docente no pueda ignorarlo al
  // scrollear. El modal se abre al intentar guardar sin respuesta
  // correcta; al cerrarlo simplemente desaparece (NO resetea `correct`
  // ni toca el form — solo es feedback).
  const [showMissingKeyDialog, setShowMissingKeyDialog] = useState(false);
  // Flag de cierre tras guardar: lo setea `onSubmit` leyendo `event.submitter`
  // (botón con `data-close-on-save="true"` → close=true) y lo consume
  // `useEffect` al detectar `state.success`. Usamos ref (no state) para que
  // el reset post-guardado no dependa del cambio de estado.
  const closeOnSaveRef = useRef(false);
  // Ref interno al <form>. Lo usamos solo si el padre NO pasa uno externo
  // (`formRef` prop); si lo pasa, ese es el que recibe la asignación en el
  // JSX. Existe para mantener el comportamiento de las llamadas internas
  // (`liveFormRef.current?.reset()`, `requestSubmit` desde el padre, etc.).
  const internalFormRef = useRef<HTMLFormElement>(null);
  // Ref que el form usa: el externo si el padre lo pasó, si no el interno.
  const liveFormRef = formRef ?? internalFormRef;

  // Popover (i) junto a "Opciones de respuesta".
  const optionsInfoRef = useRef<HTMLSpanElement>(null);
  const [isOptionsInfoOpen, setIsOptionsInfoOpen] = useState(false);

  // Click fuera o Esc → cerrar popover.
  useEffect(() => {
    if (!isOptionsInfoOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (optionsInfoRef.current && !optionsInfoRef.current.contains(t)) {
        setIsOptionsInfoOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOptionsInfoOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOptionsInfoOpen]);

  useEffect(() => {
    if (!state.success) return;
    // Tras un guardado exitoso limpiamos cualquier error de validación que
    // quedara pegado (no debería, pero por si el state.success llega tarde).
    setClientError(null);
    const closeOnSave = closeOnSaveRef.current;
    // Reset del flag para el próximo submit (Enter, "Agregar enunciado", etc.)
    closeOnSaveRef.current = false;
    if (editing) {
      // Al editar NO se limpia: el padre cierra el formulario y vuelve a la
      // vista de lectura, ya revalidada por el server action.
      onDone?.({ close: closeOnSave });
      return;
    }
    // closeOnSave=true → el padre va a desmontar el card. Saltamos el reset
    // (los inputs se desmontan igual) y notificamos para que cierre.
    if (closeOnSave) {
      onDone?.({ close: true });
      return;
    }
    onDone?.();
    liveFormRef.current?.reset();
    setOptionCount(defaultOptions);
    // Si el padre pidió `clearCorrectAfterSave`, dejamos la CLAVE sin
    // seleccionar (correct = "") para que la próxima iteración arranque
    // sin clave heredada. Caso típico: el editor unificado tras "Agregar
    // enunciado" o "Nuevo contexto" — la semántica es obligar al docente
    // a re-elegir la CLAVE en cada pregunta. Sin la prop, mantenemos el
    // comportamiento histórico: auto-marcar la primera opción visible
    // (respuesta más cómoda para el alta "rápida" desde Mis formulaciones).
    setCorrect(clearCorrectAfterSave ? "" : (ANSWER_KEYS_ORDER[0] ?? ""));
    setResetKey((k) => k + 1); // remonta el editor para limpiarlo
  }, [state.success, defaultOptions, editing, onDone, clearCorrectAfterSave]);

  const visibleKeys = ANSWER_KEYS_ORDER.slice(0, optionCount);

  function addOption() {
    if (optionCount < maxOptions) setOptionCount((n) => n + 1);
  }
  function removeOption() {
    if (optionCount <= MIN_OPTIONS) return;
    const removedKey = ANSWER_KEYS_ORDER[optionCount - 1];
    setOptionCount((n) => n - 1);
    // Si la opción eliminada era la correcta, salta a la primera visible.
    if (correct === removedKey) {
      setCorrect(ANSWER_KEYS_ORDER[optionCount - 2]!);
    }
  }

  return (
    <>
      <form
        ref={formRef ?? internalFormRef}
        action={formAction}
        lang="es"
        // Validación de cliente ANTES del submit: si el enunciado está vacío
        // bloqueamos y mostramos un mensaje claro. Sin esto, las opciones
        // tienen `required` pero el texto del RichTextEditor no, así que el
        // docente podía crear ítems con `Texto = (vacío)` si solo llenaba
        // opciones. El navegador no valida contenido JSON en hidden inputs,
        // por eso lo hacemos a mano.
        onSubmit={(e) => {
          // Capturamos QUÉ botón disparó el submit antes de cualquier otra
          // lógica. `event.submitter` es HTML5 estándar: si el form se envió
          // presionando Enter, es el primer botón submit del form (el
          // SubmitButton principal); si fue click explícito, es ese botón.
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          closeOnSaveRef.current =
            submitter instanceof HTMLButtonElement && submitter.dataset.closeOnSave === "true";

          // Bloqueamos si no hay clave/CLAVE seleccionada (ago 2026). El
          // backend exige correctAnswer no vacío; lo validamos en cliente para
          // feedback inmediato sin round-trip y para respetar la regla de
          // negocio "toda pregunta debe tener clave". Antes se mostraba como
          // <p> inline (`setClientError(...)`); a partir de ago 2026 se
          // reemplaza por un AlertDialog modal — pedido del docente: "en vez
          // de este mensaje... un alert personalizado".
          if (!correct) {
            e.preventDefault();
            setShowMissingKeyDialog(true);
            return;
          }

          const fd = new FormData(e.currentTarget);
          const textRaw = String(fd.get("text") ?? "");
          let parsed: unknown = textRaw;
          try {
            parsed = JSON.parse(textRaw);
          } catch {
            // Si no es JSON válido, lo tratamos como texto plano; isTipTapEmpty
            // también sabe manejar strings.
            parsed = textRaw;
          }
          if (isTipTapEmpty(parsed)) {
            e.preventDefault();
            setClientError("Escribe el enunciado de la pregunta antes de guardar.");
            return;
          }
          setClientError(null);
        }}
        // Traducimos los mensajes por defecto de validación HTML5 (los inputs
        // con `required` muestran "Please fill out this field" en algunos
        // navegadores). `onInvalid` se dispara cuando el browser bloquea el
        // submit por campo vacío; reescribimos el mensaje a español y lo
        // limpiamos en `onInput` cuando el usuario empieza a escribir.
        onInvalid={(e) => {
          // `e.target` puede ser cualquier form control (input, select,
          // textarea, button). Solo los controles nativos tienen
          // `setCustomValidity`; los textareas también lo tienen. Chequeamos
          // dinámicamente para no crashear si el form contiene un elemento
          // custom (p.ej. el RichTextEditor de TipTap usa contenteditable).
          const t = e.target as HTMLElement;
          if (
            "setCustomValidity" in t &&
            (t instanceof HTMLInputElement ||
              t instanceof HTMLTextAreaElement ||
              t instanceof HTMLSelectElement) &&
            t.validity.valueMissing
          ) {
            t.setCustomValidity("Llena este campo antes de guardar.");
          }
        }}
        onInput={(e) => {
          // El `onInput` burbujea desde CUALQUIER elemento editable dentro
          // del form (incluido el <div contenteditable> del RichTextEditor,
          // que NO es HTMLInputElement y por tanto NO tiene
          // `setCustomValidity`). Sin el guard anterior, este handler
          // crasheaba con `t.setCustomValidity is not a function` cada vez
          // que el docente escribía en el enunciado.
          const t = e.target as HTMLElement;
          if (
            t instanceof HTMLInputElement ||
            t instanceof HTMLTextAreaElement ||
            t instanceof HTMLSelectElement
          ) {
            t.setCustomValidity("");
          }
          // También limpiamos errores del cliente al primer keystroke en
          // cualquier elemento del form (incluido el RichTextEditor).
          if (clientError) setClientError(null);
        }}
        className="space-y-3 rounded-lg border border-dashed"
      >
        <input type="hidden" name="evaluationId" value={evaluationId} />
        <input type="hidden" name="sectionId" value={sectionId} />
        <input type="hidden" name="optionCount" value={optionCount} />
        {editing ? <input type="hidden" name="questionId" value={initial.id} /> : null}

        <div className="space-y-1">
          <RichTextEditor
            key={resetKey}
            name="text"
            minHeightClass="min-h-16"
            defaultValue={initial?.text}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
            <label className="text-foreground text-sm font-semibold">Opciones de respuesta</label>
            <span ref={optionsInfoRef} className="relative inline-block">
              <button
                type="button"
                onClick={() => setIsOptionsInfoOpen((o) => !o)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                aria-label="Más información sobre las opciones de respuesta"
                aria-expanded={isOptionsInfoOpen}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
              {isOptionsInfoOpen ? (
                <div
                  role="tooltip"
                  className="bg-popover text-popover-foreground absolute top-full left-0 z-20 mt-2 w-72 rounded-md border p-3 text-xs leading-relaxed shadow-md"
                >
                  <p>
                    Defina aquí las posibilidades que se le ofrece al evaluado para resolver el reto
                    planteado en el enunciado. Incluyen tanto la opción que resuelve plenamente la
                    tarea planteada bajo los criterios teóricos prefijados como las incorrectas
                    (distractores) pero <strong>plausibles</strong>. No se construyen al azar; en la
                    metodología ICFES, los distractores representan sesgos de razonamiento,
                    concepciones erróneas comunes o fallas frecuentes en la ejecución del
                    procedimiento. Es obligatorio indicar la respuesta correcta o clave.
                  </p>
                </div>
              ) : null}
            </span>
          </div>
          {!correct && (
            <p className="text-xs text-amber-700" role="status">
              Es obligatorio que, de entre las Opciones de respuesta creadas, seleccione la correcta
              o Clave.
            </p>
          )}
          {visibleKeys.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm font-medium">
                <input
                  type="radio"
                  name="correctAnswer"
                  value={k}
                  checked={correct === k}
                  onChange={() => setCorrect(k)}
                  className="accent-primary"
                />
                {k}
              </label>
              <Input
                name={`option${k}`}
                required
                placeholder={`Opción ${k}`}
                className="flex-1"
                defaultValue={plainOption(initial, k)}
              />
              {correct === k ? (
                <span className="text-primary text-xs font-medium">✓ correcta</span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addOption}
            disabled={optionCount >= maxOptions}
            title={
              optionCount >= maxOptions
                ? `Máximo ${maxOptions} opciones (configurado en EVAL_MAX_OPTIONS)`
                : "Agregar opción"
            }
          >
            + Opción
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={removeOption}
            disabled={optionCount <= MIN_OPTIONS}
            title={optionCount <= MIN_OPTIONS ? `Mínimo ${MIN_OPTIONS} opciones` : "Quitar última"}
          >
            − Opción
          </Button>
          <span className="text-muted-foreground text-xs">
            {optionCount} de {maxOptions} opciones
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Campo Nivel SOLO oculto temporalmente — el backend sigue aceptando el
            valor si el browser lo envía (no lo hacemos required), pero el
            formulario ya no lo expone. Reactivar descomentando el bloque. */}
          {false && (
            <div className="space-y-1">
              <label className="text-muted-foreground block text-xs font-medium">Nivel SOLO</label>
              <select
                name="soloLevel"
                defaultValue={initial?.soloLevel ?? ""}
                className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
              >
                {SOLO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Campos auxiliares ocultos en el alta y en la edición: ya no pedimos
            Componente MEN, Competencia ni Puntaje desde el form. La información
            previa (si existe) sigue visible en el `QuestionReadView` para que
            el docente la vea, pero no se ofrece edición inline. El backend
            sigue aceptando el valor si el browser lo envía, pero el form no
            los expone. Reactivar cambiando `false` por `true`. */}
          {false && (
            <>
              <div className="space-y-1">
                <label className="text-muted-foreground block text-xs font-medium">
                  Componente MEN
                </label>
                <Input
                  name="menComponent"
                  placeholder="(opcional)"
                  className="w-40"
                  defaultValue={initial?.menComponent ?? ""}
                />
              </div>
              <div className="space-y-1">
                <label className="text-muted-foreground block text-xs font-medium">
                  Competencia
                </label>
                <Input
                  name="competency"
                  placeholder="(opcional)"
                  className="w-40"
                  defaultValue={initial?.competency ?? ""}
                />
              </div>
              <div className="space-y-1">
                <label className="text-muted-foreground block text-xs font-medium">Puntaje</label>
                <Input
                  name="weight"
                  type="number"
                  step="0.5"
                  defaultValue={initial?.weight ?? 1}
                  className="w-24"
                />
              </div>
            </>
          )}
        </div>

        {(clientError ?? state.error) ? (
          <p className="text-destructive text-sm" role="alert">
            {clientError ?? state.error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton editing={editing} createLabel={createLabel} />
          {extraActions}
        </div>
      </form>
      <AlertDialog open={showMissingKeyDialog} onOpenChange={setShowMissingKeyDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Opción de respuesta requerida</AlertDialogTitle>
            <AlertDialogDescription>
              Debe marcar la Opción de respuesta correcta para poder avanzar
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowMissingKeyDialog(false)}>
              Entendido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
