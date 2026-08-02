"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Plus, Sparkles } from "lucide-react";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { richTextToPlain } from "@/components/editor/render";
import { DownloadPdfButton } from "../download-pdf-button";
import { QuestionForm, type QuestionInitialValues } from "../../question-form";
import { addSectionAction, updateSectionAction } from "../../actions";
import { ReviewModal, type QuestionLite } from "./review-modal";
import { contextLabel, type SectionLite } from "./context-label";

export interface SectionWithQuestions extends SectionLite {
  order: number;
  questions: QuestionLite[];
}

export interface UnifiedEditorData {
  evaluationId: string;
  evaluationTitle: string;
  evaluationStatus: EvaluationStatus;
  sections: SectionWithQuestions[];
  editable: boolean;
  bankQuestions: { id: string; text: string }[];
  defaultOptions: number;
  maxOptions: number;
}

/**
 * Vista "todo-en-uno" del editor. NO toca las otras dos vistas.
 *
 * Decisión clave de implementación (jul 2026): el formulario de pregunta
 * delega al `<QuestionForm>` real (mismo componente usado por
 * `[id]/page.tsx` y `contexts/[sectionId]/context-editor.tsx`). Esto evita
 * reinventar la captura del JSON TipTap del RichTextEditor (el padre no
 * tiene acceso al state interno del editor — solo el QuestionForm, que
 * controla su propio editor + submit, puede serializar correctamente el
 * contenido al FormData que espera el server action).
 *
 * Flujo:
 *  - "Nuevo contexto" → addSectionAction (solo crea la sección, sin pregunta).
 *  - "Agregar 1 a 1" → muestra <QuestionForm> vacío en la sección objetivo.
 *  - Click en un ítem → modal de revisión. "Editar" carga el QuestionForm
 *    con `initial={...}` precargado; al guardar, `onDone` cierra el form.
 */
export function UnifiedEditor({ data }: { data: UnifiedEditorData }) {
  // Sección objetivo (a la que se agrega una nueva pregunta). Por defecto
  // la de MAYOR `order` (= la última en la tabla), para que el ítem recién
  // agregado quede al final de la lista visible. Caso contrario cae en la
  // primera sección y, si las demás tienen preguntas, aparece "en medio"
  // aunque su número sea el más alto (bug visto en evaluaciones importadas
  // donde la primera sección tiene ~25 preguntas y la nueva entra con #N).
  const [targetSectionId, setTargetSectionId] = useState<string | null>(
    data.sections[data.sections.length - 1]?.id ?? data.sections[0]?.id ?? null,
  );

  // Estado del contexto a crear.
  const [draftSectionTitle, setDraftSectionTitle] = useState("");
  const [draftSectionContent, setDraftSectionContent] = useState<unknown>(null);

  // Si estamos editando un ítem existente: el QuestionForm se renderiza con
  // `initial` y al guardar `onDone` lo limpia.
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showEditingBanner, setShowEditingBanner] = useState(false);

  // Modal de revisión.
  const [reviewModal, setReviewModal] = useState<QuestionLite | null>(null);

  // Errores inline.
  const [formError, setFormError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // El form "Nuevo contexto" delega a `handleAddOrRenameSection` (definido
  // más abajo). Lo decidimos en el cliente porque el form usa un <form>
  // real con `name="title"` (no controlado) — patrón de `section-form.tsx`
  // — y queremos que la fuente de verdad al submit sea el DOM, no el state
  // de React. El botón de submit vive tanto en el bloque "Contexto" como
  // dentro del `extraActions` del QuestionForm — este último se asocia a
  // este form vía el atributo HTML5 `form="new-section-form"`, evitando
  // que se dispare el submit del QuestionForm.

  // Refs.
  const formRef = useRef<HTMLDivElement>(null);
  const contextInfoRef = useRef<HTMLSpanElement>(null);
  const enunciadoInfoRef = useRef<HTMLSpanElement>(null);
  // Ref al <form> real de "Nuevo contexto" (mismo patrón que `section-form.tsx`).
  // Lo usa el botón "Nuevo contexto" que vive dentro del `extraActions` del
  // QuestionForm: como ese botón está anidado en el `<form>` del QuestionForm,
  // no podemos hacerlo `type="submit"` sin enviar el form equivocado. La
  // solución estándar HTML5 es `form="new-section-form"` en el botón para
  // asociarlo al form de arriba, conservando el submit del QuestionForm
  // intacto.
  const newSectionFormRef = useRef<HTMLFormElement>(null);
  // Marca cuando ya disparamos la auto-creación de la sección inicial. Evita
  // loops si el addSectionAction regresa error y necesitamos reintentar.
  const autoCreatedRef = useRef(false);

  // Estado de los popovers de info (botones (i) junto a los títulos).
  const [isContextInfoOpen, setIsContextInfoOpen] = useState(false);
  const [isEnunciadoInfoOpen, setIsEnunciadoInfoOpen] = useState(false);

  // En la vista inicial, cuando NO hay ítems todavía, solo mostramos los dos
  // botones (Importar con IA / Agregar 1 a 1). Las secciones inferiores
  // (formulario de pregunta + tabla resumen) aparecen cuando el docente pulsa
  // "Agregar 1 a 1" — o de entrada, si la evaluación ya traía ítems desde
  // el banco / import.
  // `items` se calcula más abajo, así que la inicialización lazy evita
  // referenciar algo todavía no definido.
  const itemsCount = data.sections.reduce((acc, s) => acc + s.questions.length, 0);
  const [showForm, setShowForm] = useState<boolean>(itemsCount > 0);

  // Click fuera o Esc → cerrar popovers.
  useEffect(() => {
    if (!isContextInfoOpen && !isEnunciadoInfoOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (isContextInfoOpen && contextInfoRef.current && !contextInfoRef.current.contains(t)) {
        setIsContextInfoOpen(false);
      }
      if (
        isEnunciadoInfoOpen &&
        enunciadoInfoRef.current &&
        !enunciadoInfoRef.current.contains(t)
      ) {
        setIsEnunciadoInfoOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsContextInfoOpen(false);
        setIsEnunciadoInfoOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isContextInfoOpen, isEnunciadoInfoOpen]);

  // Banner de edición: scroll al top + auto-ocultar tras 5s.
  useEffect(() => {
    if (showEditingBanner) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      const t = setTimeout(() => setShowEditingBanner(false), 5000);
      return () => clearTimeout(t);
    }
  }, [showEditingBanner]);

  // Si la sección objetivo desaparece (p.ej. la borra otra pestaña o se eliminó
  // en otra vista antes de revalidar), caemos a la última disponible. Sin esto,
  // un `targetSectionId` huérfano haría que el QuestionForm enviara un
  // sectionId que ya no existe y el server action fallaría con un FK error.
  useEffect(() => {
    if (!targetSectionId || !data.sections.some((s) => s.id === targetSectionId)) {
      setTargetSectionId(data.sections[data.sections.length - 1]?.id ?? null);
    }
  }, [data.sections, targetSectionId]);

  // Auto-crea una sección inicial VACÍA cuando la evaluación no tiene ningún
  // contexto. La idea: el docente debería poder escribir preguntas (con su
  // bloque de opciones de respuesta) sin tener que crear primero un contexto
  // por obligación. La sección queda como "Sin contexto" en la tabla resumen
  // y el docente puede luego renombrarla o reagrupar preguntas en otra.
  useEffect(() => {
    if (data.sections.length === 0 && data.editable && !autoCreatedRef.current) {
      autoCreatedRef.current = true;
      const fd = new FormData();
      fd.append("evaluationId", data.evaluationId);
      // title y content intencionalmente omitidos → backend almacena null.
      void addSectionAction({}, fd).then((res) => {
        if (!res.success) {
          // Si falló (permisos, sin conexión, etc.), habilitamos reintento.
          autoCreatedRef.current = false;
          setFormError(res.error ?? "No se pudo crear la sección inicial.");
        }
      });
    }
  }, [data.sections.length, data.editable, data.evaluationId]);

  function startEdit(q: QuestionLite) {
    setEditingQuestionId(q.id);
    setTargetSectionId(q.sectionId);
    // Cargamos el contexto de la sección en los inputs de arriba para que el
    // docente vea a qué contexto pertenece la pregunta. NO permitimos editar
    // el contexto desde aquí (los inputs quedan disabled más abajo y el form
    // no envía cambios de sección): si quiere cambiar el contexto, tiene
    // que duplicar la pregunta en otra sección y borrar la original.
    const section = data.sections.find((s) => s.id === q.sectionId);
    setDraftSectionTitle(section?.title ?? "");
    setDraftSectionContent(section?.content ?? null);
    setReviewModal(null);
    setShowEditingBanner(true);
    setFormError(null);
  }

  function cancelEdit() {
    if (!window.confirm("¿ESTÁ SEGURO DE CANCELAR SIN GUARDAR?")) return;
    setEditingQuestionId(null);
    setShowEditingBanner(false);
    setFormError(null);
  }

  /**
   * Despacha el submit del form "Nuevo contexto". Decide entre:
   *   - RENOMBRAR la sección auto-creada vacía si es la única y está
   *     sin título ni contenido. Caso típico: el docente llega a una
   *     evaluación sin secciones, el `useEffect` auto-crea una vacía, el
   *     docente escribe un título y pulsa "Nuevo contexto" esperando que
   *     el badge de los ítems pase de "Ninguno" a "Especifico".
   *   - CREAR una sección nueva en cualquier otro caso (2+ secciones, o
   *     la sección actual ya tiene título/contenido).
   *
   * Lee del FormData (no del state React) por la misma razón que el form
   * original: si el docente tipea muy rápido, el último keystroke puede
   * no haber llegado al state aún. El `name="title"` del input es la
   * fuente de verdad al submit.
   */
  async function handleAddOrRenameSection(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    const contentRaw = String(formData.get("content") ?? "");
    const hasTitle = title.length > 0;
    const hasContent = contentRaw.length > 0;

    // Validación local: title O content deben estar presentes. Si falta
    // ambos, mostramos el error y evitamos el viaje al servidor (no se
    // llama preventDefault porque la función `action` se ejecuta igual;
    // cortamos acá antes del await).
    if (!hasTitle && !hasContent) {
      setFormError("Define al menos el título o el contenido del contexto antes de crearlo.");
      return;
    }
    setFormError(null);
    setActionStatus("saving");

    // Decisión: ¿hay exactamente 1 sección vacía? Si sí, RENOMBRAR.
    // Si no, CREAR nueva.
    const onlySection = data.sections.length === 1 ? data.sections[0] : null;
    const isEmpty =
      onlySection !== null &&
      onlySection !== undefined &&
      !onlySection.title &&
      !onlySection.content;

    let res: AdminFormState;
    if (isEmpty && onlySection) {
      // RENOMBRAR: construimos un FormData con sectionId para
      // updateSectionAction.
      const fd = new FormData();
      fd.append("evaluationId", data.evaluationId);
      fd.append("sectionId", onlySection.id);
      fd.append("title", title);
      if (hasContent) fd.append("content", contentRaw);
      res = await updateSectionAction({}, fd);
    } else {
      // CREAR nueva sección.
      res = await addSectionAction({}, formData);
    }

    if (res?.error) {
      setFormError(res.error);
      setActionStatus("error");
      return;
    }

    // Éxito: limpiar borradores + reset del form nativo (importante para
    // que el `name="title"` y el hidden `name="content"` del RichTextEditor
    // queden limpios). El `revalidatePath` de los server actions refresca
    // automáticamente `data.sections`, así que el badge de CONTEXTO de la
    // tabla se actualiza sin más.
    setDraftSectionTitle("");
    setDraftSectionContent(null);
    setActionStatus("saved");
    newSectionFormRef.current?.reset();
    setTimeout(() => {
      setActionStatus((cur) => (cur === "saved" ? "idle" : cur));
    }, 2500);
  }

  // Construye el `initial` para QuestionForm en modo edición.
  function editingInitial(): QuestionInitialValues | undefined {
    if (!editingQuestionId) return undefined;
    for (const s of data.sections) {
      const q = s.questions.find((qq) => qq.id === editingQuestionId);
      if (q) {
        return {
          id: q.id,
          text: q.text,
          options: q.options,
          correctAnswer: q.correctAnswer,
          justification: null,
          weight: 1,
          soloLevel: null,
          menComponent: null,
          competency: null,
        };
      }
    }
    return undefined;
  }

  const items = data.sections.flatMap((s) => s.questions);

  return (
    <div className="space-y-6">
      {/* SWITCHER DE MODO */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
        <label className="font-display text-base font-bold tracking-tight">Item</label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={!data.editable}
            title="Importar preguntas desde otra evaluación o desde el banco"
            onClick={() => {
              window.location.href = `/teacher/evaluations/${data.evaluationId}/import`;
            }}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Importar con IA
          </Button>
          <Button type="button" size="sm" variant="default" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Agregar 1 a 1
          </Button>
          {items.length > 0 ? (
            <DownloadPdfButton
              evaluationId={data.evaluationId}
              kind="booklet"
              label="Visualizar"
              variant="default"
              size="sm"
            />
          ) : null}
        </div>
      </div>

      {/* FORMULARIO PRINCIPAL + TABLA RESUMEN.
          En la vista inicial sin ítems, solo se muestran los dos botones
          superiores. El docente debe pulsar "Agregar 1 a 1" para que
          aparezcan aquí el formulario y la tabla. */}
      {showForm ? (
        <>
          <div
            ref={formRef}
            className="bg-card space-y-4 rounded-xl border-2 border-black p-5 dark:border-white"
          >
            {showEditingBanner && editingQuestionId ? (
              <div className="bg-warning/10 border-warning rounded-md border px-3 py-2 text-xs font-medium text-black">
                ⚠️ Editando pregunta existente. Los cambios se aplican al pulsar Guardar dentro del
                formulario de pregunta.
              </div>
            ) : null}

            {/* Bloque: Crear nuevo contexto (inputs). El botón para crearlo es
            el MISMO en toda la vista: cuando hay secciones, vive al lado del
            botón "Agregar enunciado" del formulario de pregunta (vía slot
            `extraActions`). Cuando NO hay secciones, no hay formulario y
            tenemos que ofrecer un botón aquí para no dejar al docente
            atascado. */}
            <section className="space-y-2 border-b pb-4">
              <h3 className="font-display flex items-center gap-1.5 text-sm font-semibold">
                Contexto
                <span ref={contextInfoRef} className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => setIsContextInfoOpen((o) => !o)}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                    aria-label="Más información sobre el contexto"
                    aria-expanded={isContextInfoOpen}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                  {isContextInfoOpen ? (
                    <div
                      role="tooltip"
                      className="bg-popover text-popover-foreground absolute top-full left-0 z-20 mt-2 w-72 rounded-md border p-3 text-xs leading-relaxed shadow-md"
                    >
                      <p>
                        Un contexto agrupa varias preguntas bajo un mismo enunciado o tema (p.ej.
                        una lectura + sus preguntas). Es <strong>opcional</strong>: si lo dejas
                        vacío, la pregunta se guarda en una sección sin contexto y aparece como{" "}
                        <em>“Sin contexto”</em> en la tabla.
                      </p>
                    </div>
                  ) : null}
                </span>
              </h3>
              {/* Form real para "Nuevo contexto" (mismo patrón que
              `section-form.tsx`). Lo usa tanto el botón de esta sección
              (cuando !targetSectionId) como el botón que vive dentro del
              `extraActions` del QuestionForm (atributo HTML5 `form=`). El
              input del título es no-controlado con `name="title"` para que
              el submit nativo incluya el valor; `defaultValue` lo precarga
              con el state por si el docente está editando. */}
              <form
                ref={newSectionFormRef}
                id="new-section-form"
                action={handleAddOrRenameSection}
                onSubmit={(e) => {
                  // Validación local: título o contenido deben estar presentes.
                  // Si falta ambos, evitamos el viaje al servidor cortando en
                  // `handleAddOrRenameSection` (que retorna temprano). El
                  // preventDefault acá evita disparar el action inválido.
                  const fd = new FormData(e.currentTarget);
                  const title = String(fd.get("title") ?? "").trim();
                  const content = String(fd.get("content") ?? "");
                  if (!title && !content) {
                    e.preventDefault();
                    setFormError(
                      "Define al menos el título o el contenido del contexto antes de crearlo.",
                    );
                    return;
                  }
                  setFormError(null);
                  setActionStatus("saving");
                }}
                onChange={() => {
                  // Mientras el docente edita el título o el contenido, limpiamos
                  // el indicador de "guardado" y el error para que no quede
                  // stale de un envío anterior.
                  if (actionStatus !== "idle") setActionStatus("idle");
                  if (formError) setFormError(null);
                }}
              >
                <input type="hidden" name="evaluationId" value={data.evaluationId} />
                <Input
                  name="title"
                  placeholder="Título de contexto (opcional)"
                  defaultValue={draftSectionTitle}
                  // Mantenemos `draftSectionTitle` en sync para que el banner de
                  // edición y la validación lean el valor actual; pero el form
                  // nativo usa `name="title"` y el DOM como fuente de verdad al
                  // enviar.
                  onChange={(e) => setDraftSectionTitle(e.target.value)}
                  disabled={!data.editable}
                  className="max-w-md"
                />
                <div className="mt-2">
                  <label className="text-muted-foreground mb-1 block text-xs font-medium">
                    Contenido del contexto (opcional)
                  </label>
                  <RichTextEditor
                    key="new-section-content"
                    name="content"
                    defaultValue={draftSectionContent}
                    onChange={(json) => setDraftSectionContent(json)}
                    minHeightClass="min-h-12"
                  />
                </div>
                {!targetSectionId && data.editable ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={actionStatus === "saving"}
                    >
                      Nuevo contexto
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      Créalo primero si quieres asociar el enun a un contexto.
                    </span>
                  </div>
                ) : null}
              </form>

              {actionStatus === "saved" && !formError && !editingQuestionId ? (
                <p className="text-primary text-xs">✓ Contexto guardado</p>
              ) : null}
            </section>

            {/* Bloque: Formulario de pregunta (delega a QuestionForm) */}
            <section className="space-y-3">
              <h3 className="font-display flex items-center gap-1.5 text-sm font-semibold">
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
                {editingQuestionId ? "Editar" : "Enunciado"}
                <span ref={enunciadoInfoRef} className="relative inline-block">
                  <button
                    type="button"
                    onClick={() => setIsEnunciadoInfoOpen((o) => !o)}
                    className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                    aria-label="Más información sobre el enunciado"
                    aria-expanded={isEnunciadoInfoOpen}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                  {isEnunciadoInfoOpen ? (
                    <div
                      role="tooltip"
                      className="bg-popover text-popover-foreground absolute top-full left-0 z-20 mt-2 w-72 rounded-md border p-3 text-xs leading-relaxed shadow-md"
                    >
                      <p>
                        Un <strong>enunciado</strong> es la pregunta que verá el estudiante, junto
                        con sus opciones de respuesta. Cada enunciado pertenece a un
                        <em> contexto</em> (o a ninguno, si lo dejas vacío). Al guardar, se numera
                        globalmente para coincidir con la hoja de respuestas.
                      </p>
                    </div>
                  ) : null}
                </span>
              </h3>

              {!data.editable ? (
                <p className="text-muted-foreground text-sm">Esta evaluación no es editable.</p>
              ) : !targetSectionId ? (
                // En la primera carga (sin secciones), el efecto de auto-creación
                // está creando la sección inicial. Mostramos un estado neutro
                // mientras llega el revalidation; si falla, `formError` aparece
                // arriba. Puede ocurrir también durante la revisión si la última
                // sección fue borrada en otra pestaña.
                <p className="text-muted-foreground text-sm">Preparando el formulario…</p>
              ) : (
                <div className="bg-muted/30 rounded-lg p-3">
                  <QuestionForm
                    key={editingQuestionId ?? `new-${targetSectionId}`}
                    evaluationId={data.evaluationId}
                    sectionId={targetSectionId}
                    defaultOptions={data.defaultOptions}
                    maxOptions={data.maxOptions}
                    initial={editingInitial()}
                    createLabel="Agregar enunciado"
                    // Una sola cadena de acciones a la derecha del submit:
                    // [Nuevo contexto?] [Guardar?] [Cancelar?]. Las dos últimas
                    // solo se muestran en modo edición; Nuevo contexto solo en
                    // modo creación. Resultado final:
                    // Orden fijo a la derecha del submit:
                    //   [Agregar enunciado] [Nuevo contexto] [Guardar] [Cancelar]
                    // - "Nuevo contexto" solo se muestra en modo creación
                    //   (en edición no tiene sentido cambiar de contexto).
                    // - "Guardar" y "Cancelar" se muestran SIEMPRE — incluso
                    //   en creación, donde "Guardar" reusa el submit del form
                    //   (atajo equivalente al botón principal) y "Cancelar"
                    //   limpia los borradores sin guardar.
                    extraActions={
                      <>
                        {editingQuestionId ? null : (
                          <Button
                            type="submit"
                            size="sm"
                            variant="default"
                            form="new-section-form"
                            disabled={!data.editable || actionStatus === "saving"}
                            title="Crea el nuevo contexto con los datos de arriba; conserva el enunciado que estés escribiendo"
                          >
                            Nuevo contexto
                          </Button>
                        )}
                        <Button
                          type="submit"
                          size="sm"
                          variant="default"
                          data-close-on-save="true"
                          disabled={!data.editable || actionStatus === "saving"}
                          title="Guardar y cerrar el card de creación"
                        >
                          Guardar
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          disabled={!data.editable || actionStatus === "saving"}
                          onClick={() => {
                            if (editingQuestionId) {
                              cancelEdit();
                              return;
                            }
                            // Modo creación: confirmar antes de descartar. Si
                            // el docente acepta, cerramos la card. La card se
                            // desmonta → los inputs del QuestionForm se pierden
                            // (no hace falta reset manual). El estado del
                            // contexto (targetSectionId, draftSectionTitle, etc.)
                            // persiste para que, si vuelve a abrir con
                            // "Agregar 1 a 1", no pierda el nombre que iba a
                            // poner.
                            if (!window.confirm("¿ESTÁ SEGURO DE CANCELAR SIN GUARDAR?")) return;
                            setShowForm(false);
                            setFormError(null);
                          }}
                        >
                          Cancelar
                        </Button>
                      </>
                    }
                    onDone={(info) => {
                      // Al guardar exitosamente: limpiamos el modo edición.
                      setEditingQuestionId(null);
                      setShowEditingBanner(false);
                      setActionStatus("saved");
                      // Si el botón submitido traía data-close-on-save="true"
                      // (caso: "Guardar"), ocultamos la card de creación.
                      // Quedan visibles solo los botones superiores y la tabla.
                      if (info?.close) {
                        setShowForm(false);
                      }
                    }}
                  />
                </div>
              )}
            </section>

            {/* Errores */}
            {formError ? (
              <p className="text-destructive text-sm" role="alert">
                {formError}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {/* TABLA RESUMEN — siempre visible cuando hay ítems, independiente
          de si la card de creación está abierta o no. Si el docente cierra
          la card con "Cancelar" o "Guardar" y ya tenía ítems creados, la
          tabla sigue ahí para que pueda seguir editando/revisando. Si no
          hay ítems, mostramos el placeholder invitando a crear el primero. */}
      {items.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          Aún no hay ítems. Crea un contexto arriba y luego agrega una pregunta.
        </p>
      ) : (
        <section className="space-y-2">
          {/* "Ítems agregados (n)" oculto por ahora — el conteo vive implícito
              en las filas y, más arriba, en el botón Visualizar. Reactivar si
              más adelante se quiere un encabezado visible. */}
          {false && (
            <h3 className="font-display text-base font-semibold">
              Ítems agregados ({items.length})
            </h3>
          )}
          <div className="overflow-x-auto rounded-xl border-2 border-black dark:border-white">
            <table className="w-full text-sm">
              <thead className="text-foreground border-b-2 border-slate-300 bg-slate-200 text-left font-bold dark:border-slate-600 dark:bg-slate-700 dark:text-white">
                <tr>
                  <th className="px-4 py-3 font-medium">DESCRIPCIÓN</th>
                  <th className="px-4 py-3 font-medium">CONTEXTO</th>
                  <th className="px-4 py-3 text-center font-medium">OPCIONES</th>
                  <th className="px-4 py-3 text-center font-medium">CLAVE</th>
                </tr>
              </thead>
              <tbody>
                {items.map((q) => {
                  let snippet = "";
                  try {
                    snippet = richTextToPlain(q.text).slice(0, 60);
                  } catch {
                    snippet = "(sin enunciado)";
                  }
                  return (
                    <tr
                      key={q.id}
                      className="hover:bg-muted/30 even:bg-muted/30 cursor-pointer border-b last:border-0 odd:bg-white"
                      onClick={() => setReviewModal(q)}
                    >
                      <td className="px-4 py-2">
                        Ítem {q.number}
                        <span className="text-muted-foreground ml-2 text-xs">
                          {snippet}
                          {snippet.length >= 60 ? "…" : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center align-top">
                        {(() => {
                          const info = contextLabel(q, data.sections);
                          return (
                            <span
                              className={
                                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase " +
                                (info.kind === "Comun"
                                  ? "bg-primary/15 text-primary"
                                  : info.kind === "Especifico"
                                    ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                                    : "bg-muted text-muted-foreground")
                              }
                            >
                              {info.kind}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2 text-center">{q.options?.length ?? 0}</td>
                      <td className="px-4 py-2 text-center font-semibold">{q.correctAnswer}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* MODAL DE REVISIÓN */}
      {reviewModal ? (
        <ReviewModal
          question={reviewModal}
          evaluationId={data.evaluationId}
          editable={data.editable}
          onClose={() => setReviewModal(null)}
          onEdit={() => startEdit(reviewModal)}
        />
      ) : null}
    </div>
  );
}
