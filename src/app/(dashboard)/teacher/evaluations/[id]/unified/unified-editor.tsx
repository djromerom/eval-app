"use client";

import { useEffect, useRef, useState } from "react";
import { Info, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import type { AdminFormState } from "@/components/admin/entity-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { isTipTapEmpty } from "@/components/editor/rich-text-empty";
import { richTextToPlain } from "@/components/editor/render";
import { DownloadPdfButton } from "../download-pdf-button";
import { QuestionForm, type QuestionInitialValues } from "../../question-form";
import {
  addQuestionAction,
  addSectionAction,
  deleteQuestionAction,
  publishEvaluationAction,
  updateQuestionAction,
  updateSectionAction,
} from "../../actions";
import { ReviewModal, type QuestionLite } from "./review-modal";
import { contextLabel, type SectionLite } from "./context-label";
import { hasUnsavedContexto } from "./save-contexto";

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
  /**
   * Oculta la card de creación/edición al montar. Se usa cuando el docente
   * llega al editor desde el listado "Mis formulaciones" (?from=list): el
   * listado es un índice y el docente suele entrar a editar UN ítem puntual,
   * no a llenar el formulario. La card sigue siendo abrible con el botón
   * "Agregar 1 a 1" del switcher de modo. Default: false (comportamiento
   * legacy).
   */
  initialHideForm?: boolean;
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
  // Sección objetivo (a la que se agrega una nueva pregunta).
  //
  // Default contextual (ago 2026):
  //  - Camino legacy (`?from` ausente o ≠"list"): última sección. Para que
  //    el ítem recién agregado quede al final de la lista visible. Caso
  //    contrario cae en la primera sección y, si las demás tienen
  //    preguntas, aparece "en medio" aunque su número sea el más alto
  //    (bug visto en evaluaciones importadas donde la primera sección
  //    tiene ~25 preguntas y la nueva entra con #N).
  //  - Camino `?from=list` (docente llega desde "Mis formulaciones"): null.
  //    Así, al abrir una formulación existente, ninguna sección queda
  //    seleccionada por accidente. `startEdit` asigna la sección real al
  //    editar un ítem; el flujo de creación persiste una sección nueva al
  //    guardar el primer enunciado.
  const [targetSectionId, setTargetSectionId] = useState<string | null>(() => {
    if (data.initialHideForm) return null;
    return data.sections[data.sections.length - 1]?.id ?? data.sections[0]?.id ?? null;
  });

  // Estado del contexto a crear.
  const [draftSectionTitle, setDraftSectionTitle] = useState("");
  const [draftSectionContent, setDraftSectionContent] = useState<unknown>(null);
  // Contador de iteraciones de "Nuevo contexto": se incrementa tras cada
  // guardado exitoso para forzar el remount del Input/RichTextEditor del
  // bloque Contexto (sus `defaultValue` solo aplican al montar). Sin esto,
  // tras "Nuevo contexto" el input del título y el editor rico conservarían
  // el texto viejo visualmente aunque el state React ya esté limpio.
  const [newSectionRenderKey, setNewSectionRenderKey] = useState(0);

  // Si estamos editando un ítem existente: el QuestionForm se renderiza con
  // `initial` y al guardar `onDone` lo limpia.
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showEditingBanner, setShowEditingBanner] = useState(false);

  // Cuando el docente edita una pregunta existente, los inputs del bloque
  // Contexto nacen DESHABILITADOS (no queremos que un cambio accidental en
  // el contexto del ítem se cuele mientras el docente solo quería editar el
  // enunciado). Para poder editar el contexto desde ahí, hace falta un
  // paso explícito: pulsar "Editar contexto" → este flag se enciende → los
  // inputs se habilitan → aparecen "Guardar/Cancelar". Se resetea a false
  // al cerrar el modo edición de pregunta (cancelEdit o tras guardar).
  // (ago 2026)
  const [editingContext, setEditingContext] = useState(false);

  // Tras guardar exitosamente (pregunta + contexto, o contexto solo) el
  // bloque Contexto se BLOQUEA: título y TipTap quedan en solo-lectura y
  // aparece el botón "Editar contexto" para que el docente desbloquee
  // explícitamente. Esto evita que tipear sobre el contexto guardado se
  // cuele en el siguiente "Agregar enunciado" como un diff no intencional.
  // El flag se apaga al pulsar "Editar contexto", al cancelar la edición
  // de pregunta, y al entrar a editar un ítem existente (donde toma el
  // mando `editingContext`). (ago 2026, pedido del docente: "tambien debe
  // bloquear el titulo y el tip tap del contexto y mostrar el boton de
  // editar contexto").
  const [contextSaved, setContextSaved] = useState(false);

  // Modo "Sin contexto" (ago 2026): cuando el docente quiere agregar un
  // ítem sin contexto (título + TipTap), pulsa el botón "Sin contexto" en
  // el extraActions del QuestionForm → este flag se enciende → el bloque
  // Contexto se oculta y, al guardar, la orquestación de contexto se
  // salta: la pregunta se persiste en la sección destino (o se crea una
  // placeholder sin título/contenido si no hay sección). El flag NO se
  // apaga tras un guardado exitoso: el docente puede encadenar varios
  // ítems "Sin contexto" sin tener que volver a pulsar el botón. Se
  // apaga al pulsar "Con contexto" (toggle inverso), al cancelar el
  // card, al iniciar la edición de un ítem, o al desmontar y volver a
  // abrir la card desde otro flujo.
  const [noContextMode, setNoContextMode] = useState(false);

  // Modal de revisión.
  const [reviewModal, setReviewModal] = useState<QuestionLite | null>(null);

  // Errores inline.
  const [formError, setFormError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  /** Toast de éxito al crear un ítem. Centraliza el copy para que un
   *  cambio futuro (p. ej. añadir tildes) toque un único punto. Se
   *  dispara en: handleAddOrRenameSection (2 ramas), handleNewContextWithQuestion
   *  y onDone del QuestionForm (cubrir "Agregar enunciado" y "Guardar" en
   *  modo creación). NO se dispara en edición ni en publicación — esos
   *  paths están filtrados por el `if (!editingQuestionId)` en onDone. */
  const TOAST_SAVED = "El ítem fue guardado de manera correcta";
  function notifyItemSaved() {
    toast.success(TOAST_SAVED);
  }

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
  // ago 2026: popover (i) junto al botón "Editar contexto" (reemplaza el
  // <span> con hint inline que pedía mucho ancho). Mismo patrón visual
  // que los dos popovers de arriba, state independiente para no chocar.
  const editarContextoInfoRef = useRef<HTMLSpanElement>(null);
  // Ref al <form> real de "Nuevo contexto" (mismo patrón que `section-form.tsx`).
  // Lo usa el botón "Nuevo contexto" que vive dentro del `extraActions` del
  // QuestionForm: como ese botón está anidado en el `<form>` del QuestionForm,
  // no podemos hacerlo `type="submit"` sin enviar el form equivocado. La
  // solución estándar HTML5 es `form="new-section-form"` en el botón para
  // asociarlo al form de arriba, conservando el submit del QuestionForm
  // intacto.
  const newSectionFormRef = useRef<HTMLFormElement>(null);
  // Ref al <form> interno del QuestionForm. Lo usa el botón "Nuevo
  // contexto" (que vive DENTRO del QuestionForm, en `extraActions`) para
  // disparar `requestSubmit()` programáticamente y reusar el orquestador
  // `overrideAction` (el mismo de "Agregar enunciado"). Sin esto, el
  // botón tenía que vivir en su propio <form> y NO podía enviar el
  // enunciado + opciones del docente junto con el nuevo contexto.
  const questionFormRef = useRef<HTMLFormElement>(null);
  // Marca "el docente acaba de pulsar Nuevo contexto y quiere empezar en
  // blanco". El useEffect de "sección objetivo inválida" respeta este flag:
  // NO re-asigna `targetSectionId` a la última sección recién creada cuando
  // está en true. Esto garantiza que el siguiente "Agregar enunciado"
  // (overrideAction) NO encuentre `contextoMatchesSection` por error y
  // meta el ítem en la sección recién creada — quiere decir que el docente
  // decidió borrar el contexto explícitamente, no reusarlo.
  // (ago 2026, pedido del docente: "que agregar enunciado no lo tome ni
  // por equivocación").
  const justCreatedContextRef = useRef(false);
  // Guarda el `targetSectionId` que tenía el contexto AL MOMENTO de
  // pulsar "Editar contexto". Mientras `editingContext=true`,
  // `handleCancelContextEdit` y `handleUpdateContext` revierten/leen
  // desde ESTE id, no desde el `targetSectionId` actual. Esto cubre el
  // caso en que un revalidate, un useEffect o un flujo concurrente
  // cambia el `targetSectionId` mientras el docente está editando: sin
  // este snapshot, cancelar/actualizar leería la sección equivocada y
  // los drafts saltarían a otra ("traerse los cambios del contexto
  // anterior"). (ago 2026, pedido del docente: "cuando le das cancelar
  // el contexto debe deshacer cambios de ese contexto no traerse los
  // cambios del contexto anterior").
  const editingOriginalSectionIdRef = useRef<string | null>(null);

  // LOCKOUT ANTI-DOBLE-SUBMIT: el `useFormStatus().pending` del SubmitButton
  // tarda un frame en reflejarse, así que un doble-click muy rápido puede
  // disparar DOS submits antes de que el botón se deshabilite. Sin lockout,
  // ambos submits ven el mismo `data.sections` (porque el primer
  // revalidatePath aún no llegó) y ambos crean su propia sección → duplicado.
  // El ref es persistente durante todo el ciclo de vida del componente.
  const submittingRef = useRef(false);
  // Debounce temporal para el segundo submit: aunque el flag booleano esté
  // bien sincronizado, si React invoca el formAction DOS veces en el mismo
  // tick (p.ej. por el Enter-keyup que también dispara click en algunos
  // browsers), el segundo pasa el guard antes de que el primero haya
  // marcado el ref. Para esos casos, además del flag miramos si el submit
  // anterior fue hace menos de 800ms y el actual va a crear sección nueva.
  const lastSubmitTsRef = useRef(0);
  // Lockout específico para "Publicar formulación". El servidor publica
  // (revalidatePath + UPDATE) puede tardar ~1s, durante el cual el botón
  // debe quedar deshabilitado. Si el usuario hace doble-click muy rápido,
  // el segundo submit llega antes del revalidate y ve status="DRAFT" —
  // intenta publicar otra vez. El flag se libera tras la respuesta (en
  // el try/finally) o cuando el status pasa a PUBLISHED (en el effect).
  const publishingRef = useRef(false);

  // Estado de los popovers de info (botones (i) junto a los títulos).
  const [isContextInfoOpen, setIsContextInfoOpen] = useState(false);
  const [isEnunciadoInfoOpen, setIsEnunciadoInfoOpen] = useState(false);
  const [isEditarContextoInfoOpen, setIsEditarContextoInfoOpen] = useState(false);

  // En la vista inicial, cuando NO hay ítems todavía, solo mostramos los dos
  // botones (Importar con IA / Agregar 1 a 1). Las secciones inferiores
  // (formulario de pregunta + tabla resumen) aparecen cuando el docente pulsa
  // "Agregar 1 a 1" — o de entrada, si la evaluación ya traía ítems desde
  // el banco / import.
  // `items` se calcula más abajo, así que la inicialización lazy evita
  // referenciar algo todavía no definido.
  const itemsCount = data.sections.reduce((acc, s) => acc + s.questions.length, 0);
  // Default: si hay ítems la card abre (legacy). Excepción: el docente llega
  // desde el listado "Mis formulaciones" (?from=list) — ahí abre cerrada
  // aunque haya ítems, porque el listado es un índice y el docente entra a
  // editar uno puntual, no a llenar el formulario. El docente siempre puede
  // abrirla con "Agregar 1 a 1".
  const [showForm, setShowForm] = useState<boolean>(data.initialHideForm ? false : itemsCount > 0);

  // Click fuera o Esc → cerrar popovers.
  useEffect(() => {
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
      if (
        isEditarContextoInfoOpen &&
        editarContextoInfoRef.current &&
        !editarContextoInfoRef.current.contains(t)
      ) {
        setIsEditarContextoInfoOpen(false);
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsContextInfoOpen(false);
        setIsEnunciadoInfoOpen(false);
        setIsEditarContextoInfoOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isContextInfoOpen, isEnunciadoInfoOpen, isEditarContextoInfoOpen]);

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
    // Si el docente acaba de pulsar "Nuevo contexto" y quiere empezar
    // en blanco, NO re-asignamos `targetSectionId` a la última sección
    // recién creada — eso haría que el siguiente "Agregar enunciado"
    // encontrara `contextoMatchesSection` y metiera el ítem en la
    // sección recién creada por error. El flag se limpia en onChange
    // del título / RichTextEditor del bloque Contexto y al inicio del
    // overrideAction, así que solo afecta al render inmediatamente
    // posterior al save de "Nuevo contexto". (ago 2026, pedido del
    // docente: "que agregar enunciado no lo tome ni por equivocación").
    //
    // FIX (ago 2026, bug reportado por el docente): el mismo flag
    // cubre el caso "Agregar enunciado" donde el orquestador acaba de
    // crear una sección nueva y aún no ha llegado el revalidate. Sin
    // esto, el `useEffect` veía `targetSectionId=sectionId_Q` no
    // presente en `data.sections` (stale) y reasignaba a la última
    // sección disponible (C8) — el snapshot de "Editar contexto"
    // quedaba apuntando a C8 y "Cancelar cambios" revertía a C8 en
    // vez de Q. Ahora limpiamos el ref cuando `data.sections` ya
    // contiene la sección objetivo (revalidate llegó).
    if (justCreatedContextRef.current) {
      if (targetSectionId && data.sections.some((s) => s.id === targetSectionId)) {
        // revalidate ya incluyó la sección recién creada → soltamos el candado.
        justCreatedContextRef.current = false;
      } else {
        // revalidate aún no llega: preservamos la asignación que hizo
        // el orquestador.
        return;
      }
    }
    // Modo "Sin contexto" (ago 2026, pedido del docente): al pulsar
    // "Sin contexto" dejamos `targetSectionId = null` para que cada
    // "Agregar enunciado" persista el ítem en una SECCIÓN PLACEHOLDER
    // NUEVA (`overrideAction` rama `noContextMode` la crea si
    // `sectionIdToUse` es null). No queremos que el effect reasigne a
    // la última sección existente mientras el modo esté activo:
    // contaminaría su contexto con ítems "Sin contexto".
    //
    // El modo se apaga al pulsar "Con Contexto", al cancelar el card
    // (`Cancelar` del extraActions), o al iniciar la edición de un
    // ítem existente (`startEdit`). A partir de ahí, el effect vuelve
    // a comportarse normalmente. (ago 2026).
    if (noContextMode) {
      // Cancelamos si el docente acaba de establecer un id que ya no
      // existe tras un revalidate (cubre el caso "placeholder recién
      // creado en una sección que fue eliminada por otro flow"). Pero
      // NO asignamos nada nuevo: respetamos el null mientras el modo
      // esté activo.
      if (targetSectionId && !data.sections.some((s) => s.id === targetSectionId)) {
        setTargetSectionId(null);
      }
      return;
    }
    // Al llegar desde "Mis formulaciones", `null` es intencional: no
    // asociamos la próxima creación a una sección existente por defecto.
    // `startEdit` asignará el id real si el docente edita un ítem.
    if (!targetSectionId) {
      if (data.initialHideForm) return;
      setTargetSectionId(data.sections[data.sections.length - 1]?.id ?? null);
      return;
    }
    if (!data.sections.some((s) => s.id === targetSectionId)) {
      setTargetSectionId(data.sections[data.sections.length - 1]?.id ?? null);
      return;
    }
    // Si la sección destino está VACÍA (sin título ni contenido) pero ya
    // hay otras secciones con contenido detrás, saltamos a la última con
    // contenido. Caso típico: la evaluación empezó con una sección vacía
    // auto-creada; tras agregar "C1"→"C2"→"C3" el targetSectionId sigue
    // apuntando a la primera sección (que ahora tiene contenido), pero si
    // en algún momento se quedó vacía otra vez (p.ej. tras renombrar y
    // luego el docente decide limpiar), mejor saltar a la última con
    // contenido para no acumular secciones fantasma.
    const target = data.sections.find((s) => s.id === targetSectionId);
    const targetIsEmpty = target && !target.title && !target.content;
    const lastWithContent = [...data.sections].reverse().find((s) => s.title || s.content);
    if (targetIsEmpty && lastWithContent && lastWithContent.id !== targetSectionId) {
      setTargetSectionId(lastWithContent.id);
    }
  }, [data.initialHideForm, data.sections, targetSectionId, noContextMode]);

  // Cuando el status pasa a PUBLISHED, liberamos el flag de publicación por
  // si quedó enganchado (p.ej. la promesa tiró excepción justo cuando llegó
  // el revalidate, y nunca se ejecutó el finally del publishHandler).
  useEffect(() => {
    if (data.evaluationStatus === "PUBLISHED") {
      publishingRef.current = false;
    }
  }, [data.evaluationStatus]);

  function startEdit(q: QuestionLite) {
    setEditingQuestionId(q.id);
    setTargetSectionId(q.sectionId);
    // Cargamos el contexto de la sección en los inputs de arriba para que el
    // docente vea a qué contexto pertenece la pregunta. NO permitimos editar
    // el contexto desde aquí (los inputs quedan disabled más abajo y el form
    // no envía cambios de sección): si quiere cambiar el contexto, tiene
    // que pulsar explícitamente "Editar contexto" en el bloque Contexto
    // (lo monta editingContext=true; los inputs se desbloquean y aparecen
    // Actualizar/Cancelar).
    const section = data.sections.find((s) => s.id === q.sectionId);
    setDraftSectionTitle(section?.title ?? "");
    setDraftSectionContent(section?.content ?? null);
    setReviewModal(null);
    setShowEditingBanner(true);
    setFormError(null);
    // Si la card de creación/edición está cerrada (caso típico: el docente
    // llegó desde "Mis formulaciones" con initialHideForm=true, o había
    // pulsado "Cerrar" tras crear un ítem), el modal "Editar" debe abrirla
    // para que el QuestionForm con el initial precargado sea visible. Sin
    // esto, cerrar el modal deja al docente sin saber dónde quedó el ítem
    // en edición. (ago 2026)
    setShowForm(true);
    // Entramos al modo edición de pregunta con el contexto BLOQUEADO por
    // default (mostramos el botón "Editar contexto", NO los inputs ya
    // habilitados). Defensivo: si el docente había entrado en modo edición
    // de contexto antes (improbable, pero posible si re-carga la misma
    // pregunta), reseteamos a false para arrancar limpio.
    setEditingContext(false);
    // Defensivo: el docente entra a editar un ítem; el control del
    // bloqueo pasa a `editingContext`. Limpiamos `contextSaved` para
    // evitar una doble marca simultánea que confundiría la lógica de
    // render del botón "Editar contexto".
    setContextSaved(false);
    // Defensivo: cualquier snapshot de "Editar contexto" previo se
    // descarta al cambiar de ítem.
    editingOriginalSectionIdRef.current = null;
    // El modo "Sin contexto" es exclusivo del flujo de creación: al
    // entrar a editar un ítem, reseteamos el flag para que la card de
    // edición muestre el bloque Contexto normalmente (con su contexto
    // precargado) en vez de mantener el modo del ítem anterior.
    setNoContextMode(false);
  }

  function cancelEdit() {
    if (!window.confirm("¿ESTÁ SEGURO DE CANCELAR SIN GUARDAR?")) return;
    setEditingQuestionId(null);
    setShowEditingBanner(false);
    setFormError(null);
    // Salimos del modo edición de pregunta: cualquier desbloqueo de
    // contexto que el docente hubiera hecho se descarta. Si vuelve a
    // editar la misma pregunta, startEdit() lo deja en false otra vez.
    setEditingContext(false);
    // Defensivo: cancelamos cualquier snapshot pendiente.
    editingOriginalSectionIdRef.current = null;
    // Cancelar la edición de un ítem implica volver al modo creación
    // desde un estado limpio. El modo "Sin contexto" es exclusivo del
    // flujo de creación: si estuviera activo por arrastre del ítem
    // anterior, lo apagamos para que la próxima creación arranque con
    // el bloque Contexto visible.
    setNoContextMode(false);
    // El docente cancela la edición de un ítem. Si el contexto estaba
    // bloqueado por `contextSaved` (de un guardado previo), lo
    // mantenemos: el bloqueo por guardado es independiente del modo
    // edición de pregunta.
  }

  /**
   * Publica la formulación. El docente debe confirmar explícitamente porque
   * PUBLISHED es la versión final (mismo flujo de "doble-click accidental"
   * que tiene PUBLISHED → DRAFT como salida). Tras publicar:
   *  - el lockout anti-doble-submit evita otro publish en ventana corta;
   *  - el server action revalida la página, lo que refresca el status
   *    y oculta automáticamente este botón (visible solo si DRAFT);
   *  - en el caso de error del server, el finally libera el lockout
   *    y mostramos el mensaje en formError.
   */
  async function handlePublish() {
    if (publishingRef.current) return;
    if (data.evaluationStatus !== "DRAFT") return; // guard local: el botón no debería renderizarse, pero por si acaso.
    if (
      !window.confirm(
        "¿Publicar la formulación? Una vez publicada se considera la versión final y solo podrá editarse enviándola primero de regreso a Borrador.",
      )
    ) {
      return;
    }
    publishingRef.current = true;
    setFormError(null);
    setActionStatus("saving");
    try {
      const fd = new FormData();
      fd.append("evaluationId", data.evaluationId);
      await publishEvaluationAction(fd);
      setActionStatus("saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo publicar la formulación.";
      setFormError(msg);
      setActionStatus("error");
    } finally {
      // Liberamos el lockout. Si el publish tuvo éxito, el revalidate ya
      // refrescó `data.evaluationStatus` y el botón desapareció; el effect
      // también libera el flag como red de seguridad.
      publishingRef.current = false;
      setTimeout(() => {
        setActionStatus((cur) => (cur === "saved" || cur === "error" ? "idle" : cur));
      }, 2500);
    }
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
    // LOCKOUT ANTI-DOBLE-SUBMIT (ver overrideAction para la explicación
    // completa). El botón "Nuevo contexto" comparte el riesgo: si el
    // docente lo pulsa dos veces rápido, ambos submits ven el mismo
    // `data.sections` viejo y crean secciones duplicadas.
    if (submittingRef.current) {
      console.warn("[Nuevo-contexto] BLOQUEADO por doble-submit");
      return;
    }
    const newCtxNowTs = Date.now();
    const newCtxSinceLast = newCtxNowTs - lastSubmitTsRef.current;
    if (newCtxSinceLast < 800 && lastSubmitTsRef.current > 0) {
      console.warn("[Nuevo-contexto] BLOQUEADO por debounce", { sinceLast: newCtxSinceLast });
      return;
    }
    lastSubmitTsRef.current = newCtxNowTs;
    submittingRef.current = true;
    try {
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

      // NOTA (ago 2026, pedido del docente): hemos ELIMINADO el dedupe
      // por título. Aunque el título escrito coincida con el de una
      // sección existente, NO reusamos ni renombramos esa sección — el
      // docente puede haber tenido un contexto repetido legítimo o
      // simple coincidencia. El id es la verdad. La única rama de
      // re-uso que queda es la decisión por id de abajo (rename-empty
      // cuando solo hay 1 sección vacía). Ese rename usa el id de la
      // sección placeholder, no el título, así que es seguro.

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
        const fd = new FormData();
        fd.append("evaluationId", data.evaluationId);
        fd.append("title", title);
        if (hasContent) fd.append("content", contentRaw);
        res = await addSectionAction({}, fd);
      }

      if (res?.error) {
        setFormError(res.error);
        setActionStatus("error");
        return;
      }

      // Éxito: tras un "Nuevo contexto" el docente quiere EMPEZAR LIMPIO,
      // no mantener el contexto precargado. Vaciamos drafts (título y
      // contenido) y dejamos targetSectionId en null para que el
      // siguiente contexto arranque en blanco. (ago 2026, pedido del
      // docente: limpiar el contexto después de haber guardado).
      setDraftSectionTitle("");
      setDraftSectionContent(null);
      setTargetSectionId(null);
      // Marcamos que el docente acaba de "Nuevo contexto" → el
      // useEffect de "sección objetivo inválida" NO debe re-asignar
      // targetSectionId a la última sección recién creada en el
      // próximo render, así el siguiente "Agregar enunciado" no
      // encuentra contexto por error. El flag se limpia en onChange
      // de los inputs o al disparar overrideAction.
      justCreatedContextRef.current = true;
      setNewSectionRenderKey((k) => k + 1);
      setActionStatus("saved");
      newSectionFormRef.current?.reset();
      // El docente acaba de "Nuevo contexto": quiere empezar en blanco.
      // Aunque la sección recién creada ya está persistida, los inputs
      // deben quedar HABILITADOS para que pueda tipear el siguiente
      // contexto. Diferencia con overrideAction (Agregar enunciado /
      // Guardar) que sí bloquea: ahí el contexto guardado es el
      // "objetivo" del docente, mientras que "Nuevo contexto" es
      // explícitamente "el siguiente, después de este". (ago 2026)
      setContextSaved(false);
      // El bloque Contexto sigue habilitado; el docente puede tipear
      // para ajustar lo recién guardado. Los botones Actualizar/Cancelar
      // aparecen al pulsar "Editar contexto" (si la sección tiene
      // contenido persistido).
      setTimeout(() => {
        setActionStatus((cur) => (cur === "saved" ? "idle" : cur));
      }, 2500);
      notifyItemSaved();
    } finally {
      submittingRef.current = false;
    }
  }

  /**
   * Disparado por el botón "Actualizar contexto" del bloque Contexto (ago
   * 2026). PERSISTE SOLO el contexto destino (título + contenido) — NO
   * toca ninguna pregunta. Complementa al orquestador de "Agregar
   * enunciado", que solo guarda contexto cuando va a crear/renombrar
   * sección como parte de la creación de un ítem.
   *
   * Caso de uso típico: el docente quiere afinar la descripción de un
   * contexto existente SIN agregar una pregunta todavía. Antes de este
   * botón, el único camino era pulsar "Agregar enunciado" (que crea
   * también una pregunta). Ahora puede pulsar "Actualizar contexto" y
   * los cambios se persisten inmediatamente sin pregunta adicional.
   *
   * Validaciones:
   *  - solo permitido si `editable` y NO estamos editando una pregunta
   *    (en modo edición los inputs del contexto van disabled).
   *  - necesita `targetSectionId` (hay una sección destino que actualizar).
   *  - necesita un diff real (`!contextoMatchesSection`) — el botón no se
   *    muestra en este caso, así que acá es una red de seguridad.
   *
   * Persistencia: `updateSectionAction` con `evaluationId`, `sectionId =
   * targetSectionId`, `title` y `content` (serializado a JSON). El
   * `revalidatePath` refresca `data.sections` así que el siguiente render
   * ve el diff ya salvado y el botón desaparece.
   */
  async function handleUpdateContext() {
    // Modo edición de pregunta + docente pulsó "Editar contexto" →
    // permitido (los botones Actualizar/Cancelar del bloque Contexto se
    // rinden con editingContext=true; sin esta relajación no podríamos
    // persistir el cambio del contexto desde el modo edición de ítem).
    if (editingQuestionId && !editingContext) return; // modo edición sin unlock
    if (submittingRef.current) {
      console.warn("[Actualizar-contexto] BLOQUEADO por doble-submit");
      return;
    }
    // Preferimos el snapshot del targetSectionId que tomamos al pulsar
    // "Editar contexto". Si está vacío, caemos al actual. (ago 2026).
    const sectionId = editingOriginalSectionIdRef.current ?? targetSectionId;
    if (!sectionId) return;

    const targetSection = data.sections.find((s) => s.id === sectionId);
    if (!targetSection) return;

    const title = draftSectionTitle.trim();
    const hasContent = hasUnsavedContexto(null, draftSectionContent);
    if (!title && !hasContent) {
      // Red de seguridad: el botón no se muestra en este caso (ver
      // `showUpdateContextButton`), pero si llegamos acá sin diff, fallamos
      // silenciosamente (no hay nada que guardar).
      return;
    }

    setFormError(null);
    setActionStatus("saving");
    submittingRef.current = true;
    lastSubmitTsRef.current = Date.now();
    try {
      const fd = new FormData();
      fd.append("evaluationId", data.evaluationId);
      fd.append("sectionId", sectionId);
      // Título vacío → null en el backend (la sección queda "Sin título");
      // consistencia con el comportamiento de la edición inline del
      // `ContextEditor` standalone.
      fd.append("title", title);
      if (draftSectionContent) {
        fd.append("content", JSON.stringify(draftSectionContent));
      }
      const res = await updateSectionAction({}, fd);
      if (res.error) {
        setFormError(res.error);
        setActionStatus("error");
        return;
      }
      setActionStatus("saved");
      // El contexto está guardado → bloqueamos los inputs y dejamos
      // solo el botón "Editar contexto" para desbloquear. (ago 2026,
      // pedido del docente).
      setContextSaved(true);
      // Si guardamos el contexto desde el flujo "Editar contexto"
      // (edición de pregunta existente), cerramos también ese flag para
      // devolver el bloque al estado default — inputs bloqueados,
      // docente sigue enfocado en editar la pregunta. En el otro flujo
      // (no-editingQuestion), `editingContext` ya era false así que el
      // setter es no-op.
      if (editingContext) setEditingContext(false);
      // Liberamos el snapshot del targetSectionId original: la sesión
      // de "Editar contexto" terminó exitosamente.
      editingOriginalSectionIdRef.current = null;
      // Persistimos cambios del contexto. El flag `contextSaved` cierra
      // también los inputs y muestra "Editar contexto" como única
      // salida.
      setTimeout(() => {
        setActionStatus((cur) => (cur === "saved" ? "idle" : cur));
      }, 2500);
    } finally {
      submittingRef.current = false;
      lastSubmitTsRef.current = 0;
    }
  }

  /**
   * Disparado por el botón "Cancelar cambios" del bloque Contexto (ago
   * 2026). REVierte los drafts locales al estado guardado de la sección
   * destino — útil cuando el docente empezó a editar el título/contenido
   * pero decide que prefiere la versión anterior sin persistir nada.
   *
   * Implementación: copiamos los valores originales desde `data.sections`
   * al state React, limpiamos errores y bumpeamos `newSectionRenderKey`
   * para forzar el remount del Input/RichTextEditor del bloque (sus
   * `defaultValue` solo aplican al montar, así que setear el state solo
   * NO se refleja visualmente — necesitamos la key nueva para que el
   * próximo render monte los inputs con el `defaultValue` original).
   *
   * NO toca el servidor: es 100% client-side. El backend ni se entera.
   */
  function handleCancelContextEdit() {
    // Modo edición de pregunta + docente pulsó "Editar contexto" →
    // permitido (botón Cancelar del bloque Contexto visible con
    // editingContext=true). Sin esta relajación no podríamos revertir
    // los drafts del contexto desde el modo edición de ítem.
    if (editingQuestionId && !editingContext) return;
    // Preferimos el snapshot del targetSectionId que tomamos al pulsar
    // "Editar contexto". Si por algún motivo ese ref está vacío (caso
    // borde: el docente abrió Cancelar sin pasar por Editar contexto),
    // caemos al targetSectionId actual. (ago 2026, pedido del docente:
    // "cuando le das cancelar el contexto debe deshacer cambios de ese
    // contexto no traerse los cambios del contexto anterior").
    const sectionId = editingOriginalSectionIdRef.current ?? targetSectionId;
    if (!sectionId) return;
    const targetSection = data.sections.find((s) => s.id === sectionId);
    if (!targetSection) return;

    // Revertimos los drafts al estado original de la sección.
    setDraftSectionTitle(targetSection.title ?? "");
    setDraftSectionContent(targetSection.content ?? null);
    // Bumpeamos la key para remontar los inputs no-controlados del bloque
    // Contexto (Input del título y RichTextEditor del contenido). Sin esto,
    // los `defaultValue` viejos seguirían visibles aunque el state React
    // ya esté limpio. Mismo patrón que el reset post-"Nuevo contexto".
    setNewSectionRenderKey((k) => k + 1);
    setFormError(null);
    setActionStatus("idle");
    // El form nativo también: por si el docente tocó algo que no
    // levantamos al state (no debería pasar, pero defensivo).
    newSectionFormRef.current?.reset();
    // Si estábamos en el flujo "Editar contexto" desde un modo edición
    // de pregunta, también cerramos ese flag para volver al estado
    // default (inputs bloqueados de nuevo, listo para tipear la
    // pregunta sin tocar el contexto por accidente).
    if (editingContext) setEditingContext(false);
    // Restauramos `contextSaved` a su valor previo al "Editar
    // contexto". Sin esto, si el docente había entrado a editar
    // contexto desde un estado guardado (`contextSaved=true`), al
    // cancelar los drafts revierten pero el flag quedaba en `false`
    // (porque lo apagamos al pulsar "Editar contexto"), dejando los
    // inputs desbloqueados y el botón "Editar contexto" oculto — el
    // docente veía un bloque Contexto editable sin contexto
    // guardado visible. (ago 2026, pedido del docente: "cuando le doy
    // al boton cancelar debe bloquear nuevamente el titulo y el
    // tiptap y mostrar el boton de editar context").
    //
    // Regla: si NO estamos editando pregunta, el contexto persistido
    // es lo que está en el form → contextSaved=true. Si SÍ estamos
    // editando pregunta, el control del bloqueo lo lleva
    // `editingQuestionId` y `contextSaved` queda en false.
    setContextSaved(editingQuestionId === null);
    // Liberamos el snapshot del targetSectionId original: ya no estamos
    // en una sesión de "Editar contexto".
    editingOriginalSectionIdRef.current = null;
  }

  /**
   * Disparado por el botón "Nuevo contexto" del `extraActions` del
   * QuestionForm.
   *
   * Semántica confirmada (ago 2026): este botón hace DOS cosas distintas
   * en un solo click:
   *   1. Persiste el enunciado+opciones del QuestionForm en la sección
   *      ACTUAL (la que tiene el `targetSectionId` actual), exactamente
   *      igual que "Agregar enunciado". El draft NO se descarta: el
   *      docente invirtió tiempo escribiéndolo y debe quedar guardado en
   *      el contexto al que pertenece semánticamente.
   *   2. Crea (o renombra, si es la única sección vacía) un NUEVO
   *      contexto con el título/contenido del bloque "Contexto" arriba.
   *      `targetSectionId` pasa a apuntar a esa nueva sección, y los
   *      drafts del bloque "Contexto" se sincronizan con su contenido
   *      (en vez de quedar vacíos) — ver PASO 3 abajo.
   *
   * Consecuencia: después de un "Nuevo contexto" exitoso, en la tabla
   * resumen aparece el ítem recién guardado en la sección anterior, y
   * los inputs del bloque "Contexto" quedan pre-cargados con el
   * título/contenido de la sección recién creada. El docente ve lo que
   * acaba de guardar y puede reusarlo para la siguiente pregunta sin
   * tener que re-tipear nada (vía `contextoMatchesSection` en el
   * overrideAction de "Agregar enunciado"). Esto replica el
   * comportamiento post-"Agregar enunciado" (consistencia UX).
   *
   * Por qué sincronizar drafts en vez de dejarlos vacíos (ago 2026): el
   * botón "Actualizar contexto" compara los drafts contra la sección
   * destino. Si drafts="" y la sección recién creada tiene
   * título="C2", ve un diff falso y aparece el botón innecesariamente.
   * Sincronizando los drafts con la sección, drafts == sección → no hay
   * diff → el botón queda oculto. Además muestra al docente el contenido
   * recién persistido, en vez de dejarlo con la impresión de que "se
   * perdió" lo que tipeó.
   *
   * Excepción (ago 2026): si el docente hace click en "Nuevo contexto"
   * pero NO escribió enunciado, interpretamos que se arrepintió y
   * descartamos todo en silencio — sin error, sin persistir sección
   * ni pregunta. Limpiamos enunciado/opciones y el bloque de contexto
   * (título + contenido) para que pueda recomenzar sin ruido.
   *
   * Recolecta los FormData de AMBOS forms directamente del DOM (no del
   * state React), porque si el docente tipea rápido el último keystroke
   * puede no haber llegado al state aún. La validación de "enunciado no
   * vacío" la hacemos acá mismo (no delegamos al onSubmit del
   * QuestionForm, porque este botón no pasa por él).
   */
  async function handleNewContextWithQuestion() {
    if (editingQuestionId) return; // solo modo creación
    if (submittingRef.current) {
      console.warn("[Nuevo-contexto+pregunta] BLOQUEADO por doble-submit");
      return;
    }
    const questionForm = questionFormRef.current;
    const sectionForm = newSectionFormRef.current;
    if (!questionForm || !sectionForm) return;

    // FormData del QuestionForm: ya trae `sectionId` = targetSectionId
    // actual desde el <input type="hidden">. La pregunta se guarda en
    // esa sección — la del contexto al que el docente la estaba
    // escribiendo semánticamente —, NO en la sección recién creada.
    //
    // NO sobreescribimos el `sectionId` en cliente. La fuente de
    // verdad es el servidor: tras `addQuestionAction`, leemos
    // `qRes.sectionId` del response y sincronizamos `targetSectionId`
    // con esa id (más abajo, en el PASO 1.5). Esto evita el desfase
    // entre el state del cliente y la sección real persistida. (ago
    // 2026, pedido del docente: usar el id de sección real del
    // response, no del cliente).
    const formData = new FormData(questionForm);
    const sectionFd = new FormData(sectionForm);
    const title = String(sectionFd.get("title") ?? "").trim();
    const contentRaw = String(sectionFd.get("content") ?? "");
    const hasTitle = title.length > 0;
    const hasContent = contentRaw.length > 0;

    // Validamos primero el enunciado. Si está vacío, interpretamos que
    // el docente se arrepintió y descartamos TODO en silencio — no
    // guardamos pregunta, no creamos contexto nuevo. Limpiamos los
    // forms y los drafts para que pueda empezar de nuevo sin error
    // visible. (ago 2026: antes mostraba un error inline, lo cual
    // resultaba ruidoso para un botón cuyo nombre sugiere "empezar
    // de nuevo".)
    const textRaw = String(formData.get("text") ?? "");
    let parsed: unknown = textRaw;
    try {
      parsed = JSON.parse(textRaw);
    } catch {
      parsed = textRaw;
    }
    if (isTipTapEmpty(parsed)) {
      setFormError(null);
      setDraftSectionTitle("");
      setDraftSectionContent(null);
      setNewSectionRenderKey((k) => k + 1);
      questionForm.reset();
      sectionForm.reset();
      // Habilitamos los inputs del bloque Contexto por si venían
      // bloqueados de un guardado anterior (contextSaved=true → input
      // disabled). El docente acaba de hacer click en "Nuevo contexto"
      // sin escribir enunciado: queremos que pueda tipear el contexto
      // inmediatamente, sin pulsar antes "Editar contexto". (ago 2026,
      // pedido del docente).
      setContextSaved(false);
      // Sincronizamos el "reset" semántico del botón: la siguiente
      // creación no debe reusar la sección destino actual, sino partir
      // de null para que el orquestador cree un contexto fresco. (ago
      // 2026, pedido del docente).
      setTargetSectionId(null);
      return;
    }

    if (!hasTitle && !hasContent) {
      setFormError("Define al menos el título o el contenido del contexto antes de crearlo.");
      return;
    }
    setFormError(null);
    setActionStatus("saving");
    submittingRef.current = true;
    lastSubmitTsRef.current = Date.now();
    try {
      // PASO 1: persistir la pregunta ACTUAL en la sección ACTUAL
      // (targetSectionId). El formData del QuestionForm ya trae ese
      // sectionId desde el <input type="hidden">, así que NO lo
      // sobreescribimos. Esto replica la semántica de "Agregar
      // enunciado" pero invocada desde el botón "Nuevo contexto" — el
      // docente preserva el trabajo que ya tenía escrito.
      const qRes = await addQuestionAction({}, formData);
      if (qRes.error) {
        setFormError(qRes.error);
        setActionStatus("error");
        return;
      }
      // Sincronizamos `targetSectionId` con la verdad del servidor: si
      // el servidor persistió la pregunta en una sección distinta a la
      // que el cliente envió (raro pero posible si hubo lógica de
      // normalización), tomamos el sectionId del response como fuente
      // de verdad. (ago 2026, pedido del docente: usar el sectionId
      // real del response).
      if (qRes.sectionId) {
        setTargetSectionId(qRes.sectionId);
      }

      // PASO 2: reusar o crear la sección con el título/contenido del
      // bloque "Contexto" arriba.
      //
      // Reglas actualizadas (ago 2026, pedido del docente: NO buscar
      // secciones por título — el id es la verdad):
      //   1. Si la única sección está VACÍA, renombrarla por id (evita
      //      el bug de "dos secciones iniciales vacías"). El rename
      //      usa el id de la sección placeholder, no el título, así
      //      que es seguro aunque el título escrito coincida con otra
      //      sección.
      //   2. En cualquier otro caso (2+ secciones, o 1 sección con
      //      contenido), CREAR una nueva sección con el título del
      //      docente — aunque el título coincida con el de una sección
      //      existente. NO dedupe por título.
      const onlySection = data.sections.length === 1 ? data.sections[0] : null;
      const isEmpty =
        onlySection !== null &&
        onlySection !== undefined &&
        !onlySection.title &&
        !onlySection.content;
      if (isEmpty && onlySection) {
        // renombrar: la única sección existente está vacía
        const fd = new FormData();
        fd.append("evaluationId", data.evaluationId);
        fd.append("sectionId", onlySection.id);
        fd.append("title", title);
        if (hasContent) fd.append("content", contentRaw);
        const renameRes = await updateSectionAction({}, fd);
        if (renameRes.error) {
          setFormError(renameRes.error);
          setActionStatus("error");
          return;
        }
      } else {
        // Crear sección nueva — siempre que NO haya una sola sección
        // vacía que renombrar. NO dedupe por título.
        const fd = new FormData();
        fd.append("evaluationId", data.evaluationId);
        fd.append("title", title);
        if (hasContent) fd.append("content", contentRaw);
        const res = await addSectionAction({}, fd);
        if (res.error) {
          setFormError(res.error);
          setActionStatus("error");
          return;
        }
        // res.sectionId puede ser null si el action no devolvió id
        // (no es nuestro caso, pero por defensa).
        if (!res.sectionId) {
          setFormError("No se pudo crear el nuevo contexto.");
          setActionStatus("error");
          return;
        }
      }

      // PASO 3: tras un "Nuevo contexto" exitoso el docente quiere
      // EMPEZAR LIMPIO — el pedido explícito fue "limpiar el contexto
      // después de haber guardado" (ago 2026). Vaciamos los drafts
      // (título y contenido) y dejamos `targetSectionId = null` para
      // que el siguiente contexto arranque en blanco. Marcamos el flag
      // `justCreatedContextRef` para que el `useEffect` de "sección
      // objetivo inválida" NO re-asigne `targetSectionId` a la última
      // sección recién creada en el próximo render — eso haría que el
      // siguiente "Agregar enunciado" encontrara `contextoMatchesSection`
      // y metiera el ítem en la sección recién creada por error. El flag
      // se limpia en onChange de los inputs del bloque Contexto o al
      // disparar overrideAction. (ago 2026, pedido del docente: "que
      // agregar enunciado no lo tome ni por equivocación").
      //
      // Por qué vaciar drafts y no sincronizarlos con la sección
      // recién creada: el botón "Actualizar contexto" compara drafts
      // contra la sección destino, pero si drafts="" y la sección
      // tiene título="C2", igual se mostraría un diff falso. El
      // docente verá un input vacío hasta que vuelva a tipear.
      //
      // Implementación:
      //  - setDraftSectionTitle("") / setDraftSectionContent(null):
      //    limpian los drafts del bloque Contexto.
      //  - setTargetSectionId(null): por si el docente encadena
      //    otro "Nuevo contexto" sin pasar por "Agregar enunciado".
      //  - justCreatedContextRef.current = true: bloquea la
      //    re-asignación automática de targetSectionId por el effect.
      //  - setNewSectionRenderKey: bumpea la key para forzar el
      //    remount del Input/RichTextEditor (no controlados; sus
      //    `defaultValue` solo aplican al montar). Tras el remount,
      //    los inputs aparecen vacíos.
      //  - questionForm.reset(): limpia enunciado + opciones del
      //    QuestionForm (siguiente pregunta arranca en blanco). El form
      //    del QuestionForm también limpia `correct`, `optionCount` y
      //    remonta el RichTextEditor del enunciado vía
      //    `clearCorrectAfterSave`.
      setDraftSectionTitle("");
      setDraftSectionContent(null);
      setTargetSectionId(null);
      justCreatedContextRef.current = true;
      setNewSectionRenderKey((k) => k + 1);
      // Reseteamos el debounce del orquestador de "Agregar enunciado".
      // Si el docente encadena otro submit inmediatamente (caso típico:
      // tras "Nuevo contexto" sigue escribiendo la siguiente pregunta),
      // el debounce de 800ms no debe bloquear esa intención legítima.
      // El flag submittingRef ya se libera en el finally de abajo.
      lastSubmitTsRef.current = 0;
      setActionStatus("saved");
      questionForm.reset();
      newSectionFormRef.current?.reset();
      // Tras un "Nuevo contexto" + pregunta exitoso, los inputs del
      // bloque Contexto deben quedar HABILITADOS para que el docente
      // pueda tipear el siguiente contexto sin pulsar "Editar contexto"
      // primero. Coherente con handleAddOrRenameSection (línea 581) y
      // con la semántica del botón: "Nuevo contexto" es explícitamente
      // "el siguiente, después de este". (ago 2026, pedido del docente).
      setContextSaved(false);
      setTimeout(() => {
        setActionStatus((cur) => (cur === "saved" ? "idle" : cur));
      }, 2500);
      notifyItemSaved();
    } finally {
      submittingRef.current = false;
    }
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

  // Predicado compartido: ¿se muestra el botón "Editar contexto" del
  // bloque Contexto? Es la MISMA regla que aplicamos a "Nuevo contexto"
  // del QuestionForm (siguiente use): ambos viven en el mismo flujo
  // "existe un contexto persistido listo para afinar". Si la regla
  // cambia, ambos botones cambian en bloque. (ago 2026, pedido del
  // docente: "que [Nuevo contexto] aparezca cuando aparece el boton de
  // 'Editar contexto'").
  //   - edición de pregunta existente → editar contexto es útil
  //   - tras un guardado (contextSaved=true) → editar contexto desbloquea
  //   - cualquier otro caso (contexto recién inicial, nunca persistido):
  //     NO se muestra, y "Nuevo contexto" tampoco.
  const showEditContextButton =
    data.editable && !editingContext && (editingQuestionId !== null || contextSaved);

  return (
    <div className="space-y-6">
      {/* SWITCHER DE MODO */}
      <div className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
        <label className="font-display text-base font-bold tracking-tight">Formular ítem</label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            //ocultar boton de importar preguntas si la evaluación no es editable
            hidden={true}
            disabled={!data.editable}
            title="Importar preguntas desde otra evaluación o desde el banco"
            onClick={() => {
              window.location.href = `/teacher/evaluations/${data.evaluationId}/import`;
            }}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Importar con IA
          </Button>
          {/* "Agregar 1 a 1" solo aparece cuando el card de creación/edición
            está OCULTO. Cuando el card ya está visible, ese botón sería
            redundante (el docente ya está creando/editando) y genera la
            sensación de que hay dos modos paralelos. Al cerrar el card
            (guardando o cancelando) el botón reaparece.
            (ago 2026) "Con Contexto" abre la card con el bloque Contexto
            visible (título + TipTap). "Sin contexto" abre la card con
            el bloque Contexto OCULTO: el docente solo ve el enunciado
            y las opciones de respuesta. La pregunta que se guarde en
            este modo va a una sección placeholder (sin título ni
            contenido), que es la "sección Sin contexto" del modelo. */}
          {!showForm ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => {
                  setShowForm(true);
                  setNoContextMode(false);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Con Contexto
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={() => {
                  setShowForm(true);
                  setNoContextMode(true);
                  // Dejamos `targetSectionId` en null al pulsar
                  // "Sin contexto" para que cada "Agregar enunciado"
                  // persista el ítem en una SECCIÓN PLACEHOLDER NUEVA
                  // sin título ni contenido (`overrideAction` rama
                  // `noContextMode` la crea si `sectionIdToUse` es
                  // null). Si asignáramos la última sección aquí, los
                  // ítems "Sin contexto" se apilarían en una sección
                  // existente con contenido, contaminando su contexto.
                  //
                  // El `useEffect` de sincronización (más abajo)
                  // respeta este null mientras `noContextMode` esté
                  // activo: solo reasigna a la última sección cuando
                  // NO estamos en modo "Sin contexto". Así no pisamos
                  // el null del docente. (ago 2026, pedido del
                  // docente: "cuando se le da click al boton sin
                  // contexto debe dejar en blanco el targetSectionId
                  // para que el proximo lo guarde sin contexto").
                  setTargetSectionId(null);
                  // Misma limpieza que hace "Nuevo contexto" tras
                  // guardar (handler handleAddOrRenameSection, líneas
                  // 596-602): vaciamos los drafts del bloque Contexto
                  // (Título + TipTap) y bumpeamos la key para remontar
                  // los inputs no-controlados. El bloque sigue
                  // OCULTO mientras `noContextMode=true`, pero al
                  // volver a pulsar "Con Contexto", el docente lo ve
                  // con Título/TipTap VACÍOS — exactamente el mismo
                  // estado que tendría si acabara de "Nuevo contexto".
                  // (ago 2026, pedido del docente: "después de dar
                  // click en el botón sin contexto hacer la misma
                  // acción que hace el botón nuevo contexto para
                  // limpiar el título y el tip tap del contexto").
                  setDraftSectionTitle("");
                  setDraftSectionContent(null);
                  setNewSectionRenderKey((k) => k + 1);
                  // Si el docente venía de un guardado (contextSaved=true,
                  // inputs bloqueados por la derecha), al pasar a "Sin
                  // contexto" debe poder tipear libremente si vuelve a
                  // "Con contexto". Mismo rationale que
                  // handleAddOrRenameSection línea 615.
                  setContextSaved(false);
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Sin contexto
              </Button>
            </>
          ) : null}
          {items.length > 0 ? (
            <DownloadPdfButton
              evaluationId={data.evaluationId}
              kind="booklet"
              label="Visualizar"
              variant="default"
              size="sm"
            />
          ) : null}
          {/* "Publicar formulación" — atajo DRAFT → PUBLISHED del editor
            unificado (ago 2026). Solo visible cuando:
              - hay al menos un ítem (no se puede publicar una formulación vacía)
              - status === "DRAFT" (las transiciones IN_REVIEW/APPROVED siguen
                su flujo canónico por la maquina de estados; PUBLISHED ya
                publicada muestra el CTA como el botón "Publicar formulación"
                pero NO está en DRAFT, así que este botón se oculta).
            Llama al server action publishEvaluationAction; handlePublish
            confirma con window.confirm + lockout anti-doble-submit. */}
          {data.editable && items.length > 0 && data.evaluationStatus === "DRAFT" ? (
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => {
                void handlePublish();
              }}
              disabled={publishingRef.current}
              title="Publicar la formulación como versión final"
            >
              <Send className="mr-1 h-3.5 w-3.5" /> Publicar formulación
            </Button>
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
                ⚠️ Editando ítem. Los cambios se aplican al pulsar Guardar cambios
              </div>
            ) : null}

            {/* Bloque: Crear nuevo contexto (inputs). El botón para crearlo es
            el MISMO en toda la vista: cuando hay secciones, vive al lado del
            botón "Agregar enunciado" del formulario de pregunta (vía slot
            `extraActions`). Cuando NO hay secciones, no hay formulario y
            tenemos que ofrecer un botón aquí para no dejar al docente
            atascado. */}
            {/* Modo "Sin contexto" (ago 2026): el docente pulsó el botón
            "Sin contexto" del extraActions → ocultamos el bloque entero
            (título + TipTap del contexto + botones Actualizar/Cancelar
            del contexto). El ítem que se guarde a continuación no
            tendrá contexto. */}
            {!noContextMode ? (
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
                          Este campo es opcional, siempre y cuando no haya diligenciado el campo
                          anterior de título. Ingrese aquí un texto, gráfica, tabla, formula y/o
                          diagrama, en caso que se requiera de esta información previa para enmarcar
                          la evaluación del ítem. Este componente garantiza que el ítem evalúe el
                          saber-hacer en contexto y no la simple memorización.
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
                    key={
                      editingQuestionId
                        ? `edit-title-${editingQuestionId}-${targetSectionId ?? "none"}`
                        : `new-section-title-${newSectionRenderKey}`
                    }
                    name="title"
                    placeholder="Título de contexto (opcional)"
                    defaultValue={draftSectionTitle}
                    // Mantenemos `draftSectionTitle` en sync para que el banner de
                    // edición y la validación lean el valor actual; pero el form
                    // nativo usa `name="title"` y el DOM como fuente de verdad al
                    // enviar. La key cambia en modo edición para forzar el
                    // remount y que el `defaultValue` se aplique al precargar
                    // el contexto de la pregunta editada.
                    onChange={(e) => {
                      setDraftSectionTitle(e.target.value);
                      // El docente volvió a tipear tras un "Nuevo contexto":
                      // re-habilitamos la lógica normal de asignación de
                      // targetSectionId en el effect. Si NO limpiáramos el
                      // flag, jamás volvería a apuntar a una sección
                      // existente al tipear (quedaría huérfano de cualquier
                      // contexto para siempre).
                      if (justCreatedContextRef.current) {
                        justCreatedContextRef.current = false;
                      }
                    }}
                    // Input HABILITADO por defecto (ago 2026): el docente
                    // pidió tipear libremente sobre una formulación
                    // existente desde "Mis formulaciones" sin verse forzado
                    // a pulsar un botón "Editar contexto" primero. Solo se
                    // bloquea cuando la evaluación no es editable, o cuando
                    // el contexto está en estado "guardado/bloqueado" SIN
                    // haber pulsado "Editar contexto" (puede ser por un
                    // guardado previo reciente, `contextSaved=true`, o por
                    // estar editando una pregunta existente sin unlock).
                    // Al pulsar "Editar contexto" → `editingContext=true` →
                    // ambos términos se desactivan → inputs habilitados.
                    // (ago 2026, pedido del docente: "después de darle
                    // editar contexto debe habilitar el titulo y el tiptap
                    // del contexto").
                    disabled={
                      !data.editable ||
                      (!editingContext && (contextSaved || editingQuestionId !== null))
                    }
                    className="max-w-md"
                  />
                  <div className="mt-2">
                    <label className="text-muted-foreground mb-1 block text-xs font-medium">
                      Contenido del contexto (opcional)
                    </label>
                    <RichTextEditor
                      // Key dependiente del modo: cuando entramos a editar un
                      // ítem (startEdit), draftSectionContent pasa de null al
                      // JSON real de la sección, pero TipTap solo lee
                      // `defaultValue` en mount. Sin remontar el editor, el
                      // "Contenido del contexto (opcional)" seguiría vacío al
                      // editar. Usamos una key distinta en modo edición para
                      // forzar el remount.
                      key={
                        editingQuestionId
                          ? `edit-question-${editingQuestionId}-${targetSectionId ?? "none"}`
                          : `new-section-content-${newSectionRenderKey}`
                      }
                      name="content"
                      defaultValue={draftSectionContent}
                      onChange={(json) => {
                        setDraftSectionContent(json);
                        // Mismo rationale que el onChange del título: el
                        // docente volvió a tipear → re-habilitamos la
                        // asignación automática de targetSectionId en el
                        // effect (siguiente render). Sin esto, el flag
                        // quedaría pegado y targetSectionId nunca volvería
                        // a apuntar a una sección existente.
                        if (justCreatedContextRef.current) {
                          justCreatedContextRef.current = false;
                        }
                      }}
                      // Misma regla que el Input del título (ago 2026):
                      // HABILITADO por defecto. Se bloquea solo cuando la
                      // evaluación no es editable o cuando el contexto
                      // está en estado "guardado/bloqueado" SIN haber
                      // pulsado "Editar contexto". Al pulsar "Editar
                      // contexto" → `editingContext=true` → ambos términos
                      // se desactivan → TipTap habilitado. `disabled`
                      // mapea a `editable: false` dentro de TipTap y oculta
                      // Toolbar/controles.
                      disabled={
                        !data.editable ||
                        (!editingContext && (contextSaved || editingQuestionId !== null))
                      }
                      minHeightClass="min-h-12"
                    />
                  </div>
                  {/* Botones de gestión del bloque Contexto (ago 2026).
                  Tres estados visuales mutuamente excluyentes:
                    (a) Edición de pregunta existente con contexto BLOQUEADO
                        (editingQuestionId && !editingContext) O contexto recién
                        guardado (!editingContext && contextSaved) → botón
                        único "Editar contexto" para que el docente desbloquee
                        los inputs.
                    (b) editingContext=true → "Actualizar/Cancelar" aparecen
                        inmediatamente, sin esperar a que el docente tipee
                        (ago 2026, pedido del docente) y sin importar si la
                        sección persistida tiene contenido previo (la sección
                        placeholder de "Sin contexto" cae aquí — antes los
                        botones quedaban ocultos por el guard
                        `sectionHasSavedContent` y el docente no podía
                        guardar el contexto recién tipeado).
                    (c) Cualquier otro caso (no editable, contexto bloqueado
                        sin click previo) → nada.

                  Por qué el botón (a) existe solo en modo edición de
                  pregunta o tras un guardado: en el flujo normal "Mis
                  formulaciones" (b7bb2c7) los inputs nacen habilitados
                  por default para no forzar al docente a pulsar una
                  entrada extra. Pero al EDITAR una pregunta, los inputs
                  sí están bloqueados (riesgo de cambios accidentales
                  sobre el contexto del ítem mientras el docente solo
                  quería editar el enunciado), y entonces necesitamos el
                  botón explícito para entrar al modo edición del
                  contexto. Mismo caso tras un guardado reciente:
                  `contextSaved=true` bloquea los inputs hasta que el
                  docente decida explícitamente tocar el contexto de
                  nuevo. */}
                  {(() => {
                    const targetSection =
                      targetSectionId === null
                        ? null
                        : (data.sections.find((s) => s.id === targetSectionId) ?? null);

                    // Comparamos drafts contra el estado guardado de la
                    // sección destino para detectar diff real en título y/o
                    // contenido (TipTap). Texto plano vía `richTextToPlain`
                    // para no entrar en ruido de diferencias estructurales
                    // del JSON TipTap (p.ej. marcas de posición del cursor).
                    const draftTitleTrimmed = draftSectionTitle.trim();
                    const sectionTitleTrimmed = (targetSection?.title ?? "").trim();
                    const titleChanged = draftTitleTrimmed !== sectionTitleTrimmed;
                    const draftContentPlain = richTextToPlain(draftSectionContent).trim();
                    const sectionContentPlain = richTextToPlain(targetSection?.content).trim();
                    const contentChanged = draftContentPlain !== sectionContentPlain;

                    // (a) Edición de pregunta + contexto bloqueado, O
                    // contexto recién guardado → botón "Editar contexto".
                    // El primer modo evita cambios simultáneos sobre
                    // ítem + contexto al editar una pregunta existente;
                    // el segundo bloquea el contexto tras un guardado
                    // exitoso (sea vía "Nuevo contexto", "Agregar
                    // enunciado" o "Guardar") para que un tipeo
                    // accidental no se cuele como diff en el siguiente
                    // submit. (ago 2026, pedido del docente).
                    if (showEditContextButton) {
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={actionStatus === "saving"}
                            onClick={() => {
                              // NO tocamos `contextSaved` aquí: ese flag
                              // representa "el contexto persistido es el
                              // que está en el form". Entrar a modo
                              // edición de contexto no cambia ese hecho.
                              // Si el docente cancela los cambios,
                              // `handleCancelContextEdit` restaura el
                              // flag a su valor previo (true si no
                              // estamos editando pregunta, false si sí).
                              // Tomamos un snapshot del targetSectionId
                              // actual para que Cancelar/Actualizar
                              // contexto operen sobre esta sección
                              // original aunque el targetSectionId cambie
                              // durante la edición.
                              editingOriginalSectionIdRef.current = targetSectionId;
                              setEditingContext(true);
                            }}
                          >
                            Editar contexto
                          </Button>
                          <span ref={editarContextoInfoRef} className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => setIsEditarContextoInfoOpen((o) => !o)}
                              className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors"
                              aria-label="Más información sobre Editar contexto"
                              aria-expanded={isEditarContextoInfoOpen}
                            >
                              <Info className="h-3.5 w-3.5" />
                            </button>
                            {isEditarContextoInfoOpen ? (
                              <div
                                role="tooltip"
                                className="bg-popover text-popover-foreground absolute top-full left-0 z-20 mt-2 w-72 rounded-md border p-3 text-xs leading-relaxed shadow-md"
                              >
                                <p>
                                  Modifica el título o el contenido del contexto asociado a esta
                                  pregunta.
                                </p>
                              </div>
                            ) : null}
                          </span>
                        </div>
                      );
                    }

                    // (b) "Actualizar contexto" + "Cancelar cambios"
                    // aparecen SOLO cuando se cumplen TODAS estas
                    // condiciones (ago 2026):
                    //   1. La evaluación es editable.
                    //   2. editingContext=true: el docente pulsó
                    //      explícitamente el botón "Editar contexto" del
                    //      bloque Contexto. Sin ese click, los botones
                    //      permanecen ocultos.
                    //
                    // ANTES se pedía también `sectionHasSavedContent`: si
                    // la sección destino estaba vacía (caso típico de
                    // "Sin contexto" — el placeholder auto-creado por el
                    // modo sin-contexto tiene title=null y content=null),
                    // los botones quedaban ocultos incluso después de
                    // pulsar "Editar contexto" y tipear. El docente no
                    // tenía forma de persistir el contexto recién tipeado
                    // sobre la sección placeholder. Bug reportado en ago
                    // 2026: "editar contexto no está funcionando
                    // normalmente trata de mostrar los botones de
                    // actualizar contexto y cancelar contexto pero no lo
                    // consigue".
                    //
                    // También se pedía antes `contextoDirty` y diff real
                    // (`titleChanged || contentChanged`). El docente
                    // pidió (ago 2026) que los botones aparezcan
                    // INMEDIATAMENTE al pulsar "Editar contexto", sin
                    // esperar a que el docente tipee algo. Si no hay diff
                    // y pulsa "Actualizar contexto", el handler ejecuta
                    // un UPDATE no-op en el servidor (mismos valores →
                    // mismo estado), lo cual es inofensivo. Si pulsa
                    // "Cancelar cambios", los drafts revierten al estado
                    // persistido sin tocar el servidor.
                    const showUpdateContextButton = data.editable && editingContext;
                    if (!showUpdateContextButton) return null;

                    // Mensaje de confirmación específico según QUÉ cambió.
                    let whatChanges: string;
                    if (titleChanged && contentChanged) {
                      whatChanges = "el título y el contenido";
                    } else if (titleChanged) {
                      whatChanges = "el título";
                    } else {
                      whatChanges = "el contenido";
                    }

                    return (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          disabled={actionStatus === "saving"}
                          title="Guardar los cambios del contexto sin agregar una pregunta"
                          onClick={() => {
                            const ok = window.confirm(
                              `¿Está seguro que desea actualizar ${whatChanges} del contexto?`,
                            );
                            if (!ok) return;
                            void handleUpdateContext();
                          }}
                        >
                          Actualizar contexto
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={actionStatus === "saving"}
                          title="Revertir los cambios no guardados al estado original"
                          onClick={() => {
                            handleCancelContextEdit();
                          }}
                        >
                          Cancelar cambios
                        </Button>
                      </div>
                    );
                  })()}
                </form>
              </section>
            ) : null}

            {/* Bloque: Formulario de pregunta (delega a QuestionForm) */}
            <section className="space-y-3">
              <h3 className="font-display flex items-center gap-1.5 text-sm font-semibold">
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
                {"Enunciado"}
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
                        Este campo es obligatorio. Redacte aquí la pregunta o instrucción explícita
                        que plantea el reto cognitivo. Debe contener toda la información
                        indispensable para que el estudiante comprenda lo que se le solicita de
                        forma inequívoca.
                      </p>
                    </div>
                  ) : null}
                </span>
              </h3>

              {!data.editable ? (
                <p className="text-muted-foreground text-sm">Esta evaluación no es editable.</p>
              ) : (
                <div className="bg-muted/30 rounded-lg p-3">
                  <QuestionForm
                    key={editingQuestionId ?? `new-${targetSectionId ?? "empty"}`}
                    evaluationId={data.evaluationId}
                    sectionId={targetSectionId ?? ""}
                    defaultOptions={data.defaultOptions}
                    maxOptions={data.maxOptions}
                    formRef={questionFormRef}
                    initial={editingInitial()}
                    createLabel="Agregar enunciado"
                    hideSubmit={true}
                    extraActionsLeft={
                      // "Nuevo contexto" aparece cuando aparece el botón
                      // "Editar contexto" del bloque Contexto. Reusamos
                      // el mismo predicado (`showEditContextButton`, ver
                      // arriba) en lugar de duplicar la lógica:
                      //   - edición de ítem existente → aparece
                      //   - tras un guardado del contexto (contextSaved) → aparece
                      //   - cualquier otro caso (creación inicial sin
                      //     contexto persistido, ya sea 0 secciones o
                      //     solo placeholders) → OCULTO, y el docente
                      //     usa "Agregar enunciado" para arrancar.
                      // Razón semántica: "Nuevo contexto" presupone un
                      // contexto previo al que estamos a punto de bifurcar.
                      // Si no hay ningún contexto persistido, no hay
                      // bifurcación posible. (ago 2026, pedido del
                      // docente: "que aparezca cuando aparece el boton
                      // de 'Editar contexto'").
                      showEditContextButton ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          disabled={!data.editable || actionStatus === "saving"}
                          title="Crea un nuevo contexto y guarda aquí el enunciado + opciones que estés escribiendo"
                          onClick={() => {
                            void handleNewContextWithQuestion();
                          }}
                        >
                          Nuevo contexto
                        </Button>
                      ) : null
                    }
                    // "Nuevo contexto" va en `extraActionsLeft` (slot
                    // izquierdo del `flex justify-between` de la fila de
                    // acciones). Así comparte FILA HORIZONTAL con submit/
                    // Guardar/Cancelar pero queda a la IZQUIERDA, "al
                    // principio" como pidió el docente (ago 2026:
                    // "que aparezca a principio pero en la misma linea
                    // horizontal de los demas botones"). En edición de
                    // ítem no aplica (no tiene sentido cambiar de contexto
                    // sobre una pregunta existente).
                    // Tras "Agregar enunciado" (y "Nuevo contexto", que
                    // reutiliza el mismo submit vía overrideAction) el
                    // docente debe re-elegir la CLAVE en la siguiente
                    // pregunta — no queremos heredar la del ítem recién
                    // guardado. Solo aplica en modo creación: en edición
                    // el form no se resetea tras guardar.
                    clearCorrectAfterSave={!editingQuestionId}
                    // ORQUESTACIÓN CONTEXTO + PREGUNTA EN UN SOLO CLICK.
                    // Antes el "Agregar enunciado" solo disparaba
                    // addQuestionAction → la pregunta se guardaba en la
                    // sección actual (vacía) y los inputs de título /
                    // contenido del bloque Contexto se perdían. Ahora, si el
                    // docente tiene cambios pendientes en el contexto, los
                    // guardamos PRIMERO (renombrando la sección vacía si
                    // aplica, o creando una nueva) y luego guardamos la
                    // pregunta en la sección resultante.
                    //
                    // En modo edición (`editingQuestionId !== null`) los
                    // inputs de contexto están disabled — no hay nada que
                    // orquestar — y el formData trae `questionId`, así que
                    // delegamos directo a updateQuestionAction.
                    overrideAction={async (formData) => {
                      if (editingQuestionId) {
                        return updateQuestionAction({}, formData);
                      }
                      // El docente está disparando "Agregar enunciado"
                      // (o "Guardar") desde el QuestionForm — momento en
                      // el cual el flag ya no es relevante (estamos
                      // procesando el submit). Limpiamos por defensa:
                      // cualquier onChange posterior volverá a setear el
                      // título/contenido, así que el effect tendrá el
                      // estado correcto.
                      if (justCreatedContextRef.current) {
                        justCreatedContextRef.current = false;
                      }
                      const nowTs = Date.now();
                      // LOCKOUT ANTI-DOBLE-SUBMIT con DEBOUNCE por timestamp.
                      // El flag booleano solo no alcanza: React puede invocar
                      // el formAction dos veces en el mismo tick antes de que
                      // el `try` haya seteado `submittingRef.current = true`.
                      // Si los dos submits ven el mismo `data.sections` viejo
                      // (porque el primer revalidatePath aún no llegó), ambos
                      // crean su propia sección → duplicado. La capa extra es
                      // temporal: si entre el submit anterior y este pasaron
                      // menos de 800ms Y el orquestador va a crear una sección
                      // nueva, lo bloqueamos. Si es una edición/reuso no
                      // afecta.
                      if (submittingRef.current) {
                        console.warn("[Agregar-enunciado] BLOQUEADO por doble-submit");
                        return {};
                      }
                      const debounceWindow = 800;
                      const sinceLast = nowTs - lastSubmitTsRef.current;
                      // FIX (ago 2026, bug del docente): leer el borrador
                      // del contexto desde el DOM (form nativo
                      // `newSectionFormRef.current`) en lugar de desde
                      // React state. Si el docente tipea rápido y pulsa
                      // "Agregar enunciado" antes de que React batchee el
                      // último keystroke, `draftSectionTitle` /
                      // `draftSectionContent` quedan stale y la sección
                      // nueva se crea sin título → el ítem queda con
                      // NINGUNO. Mismo patrón que
                      // `handleNewContextWithQuestion` (línea 829). El
                      // Input/RichTextEditor son no controlados
                      // (`defaultValue`), así que el DOM es la fuente de
                      // verdad en el momento del click. Si el form aún
                      // no está montado (caso extremo), caemos al state
                      // como antes para no romper.
                      const sectionFormFd = newSectionFormRef.current
                        ? new FormData(newSectionFormRef.current)
                        : null;
                      const orchestratorTitle = sectionFormFd
                        ? String(sectionFormFd.get("title") ?? "").trim()
                        : draftSectionTitle.trim();
                      const orchestratorContentRaw = sectionFormFd
                        ? String(sectionFormFd.get("content") ?? "")
                        : draftSectionContent
                          ? JSON.stringify(draftSectionContent)
                          : "";
                      let orchestratorContent: unknown = null;
                      if (orchestratorContentRaw) {
                        try {
                          orchestratorContent = JSON.parse(orchestratorContentRaw);
                        } catch {
                          orchestratorContent = null;
                        }
                      }
                      // TEMP DEBUG (ago 2026): log para verificar qué está
                      // leyendo del DOM vs del state. Borrar tras diagnosticar.
                      // (movido tras `willCreate` para acceder a esa var)
                      const debugOrchestrator = {
                        domTitle: orchestratorTitle,
                        stateTitle: draftSectionTitle,
                        domContentLen: orchestratorContentRaw.length,
                        stateContentLen: draftSectionContent
                          ? JSON.stringify(draftSectionContent).length
                          : 0,
                        formRefAttached: newSectionFormRef.current !== null,
                      };
                      // willCreate: solo true si NO hay sección destino (targetSectionId
                      // apunta a sección existente → siempre reusamos, no creamos).
                      // Antes (jul 2026) se comparaba draft vs sección destino
                      // vía contextoMatchesSection; eso producía duplicados cuando
                      // el docente refinaba el título entre dos clicks. Ahora el
                      // id es la verdad. (ago 2026, pedido del docente).
                      // FIX (ago 2026): usa los valores leídos del DOM
                      // (`orchestratorTitle` / `orchestratorContent`) en vez de
                      // React state, para no perder el último keystroke.
                      const willCreate =
                        hasUnsavedContexto(orchestratorTitle, orchestratorContent) &&
                        !data.sections.some((s) => s.id === targetSectionId);
                      // TEMP DEBUG (ago 2026): log ampliado con el branch info.
                      console.log("[override] DOM vs state + branch", {
                        ...debugOrchestrator,
                        targetSectionId,
                        sectionsLen: data.sections.length,
                        willCreate,
                      });
                      if (sinceLast < debounceWindow && willCreate && lastSubmitTsRef.current > 0) {
                        console.warn("[Agregar-enunciado] BLOQUEADO por debounce", {
                          sinceLast,
                          willCreate,
                          debounceWindow,
                        });
                        return {};
                      }
                      lastSubmitTsRef.current = nowTs;
                      submittingRef.current = true;
                      try {
                        // MODO "SIN CONTEXTO" (ago 2026): el docente eligió
                        // explícitamente NO crear/editar un contexto. Saltamos
                        // TODA la orquestación de contexto (Branches 1-4 de
                        // abajo) y guardamos la pregunta en la sección
                        // destino (o creamos un placeholder sin título/contenido
                        // si no hay sección). No tocamos el flag
                        // `noContextMode` aquí — el docente puede encadenar
                        // varios ítems "Sin contexto" sin tener que volver a
                        // pulsar el botón. Solo se apaga al pulsar "Con
                        // contexto" (toggle inverso en extraActions) o al
                        // cancelar la card.
                        if (noContextMode) {
                          let sectionIdToUse = targetSectionId;
                          if (!sectionIdToUse) {
                            // No hay sección destino: crear un placeholder
                            // (sin título ni contenido). El server action
                            // `addSectionAction` acepta ambos como undefined
                            // → la sección queda con title=null y content=null,
                            // que es la sección "Sin contexto" del modelo.
                            const createFd = new FormData();
                            createFd.append("evaluationId", data.evaluationId);
                            const created = await addSectionAction({}, createFd);
                            if (!created.success || !created.sectionId) {
                              setFormError(
                                created.error ?? "No se pudo crear la sección placeholder.",
                              );
                              setActionStatus("error");
                              return created;
                            }
                            sectionIdToUse = created.sectionId;
                            setTargetSectionId(created.sectionId);
                            // FIX (ago 2026, análogo a Branches 1 y 4):
                            // bloqueamos la re-asignación automática de
                            // targetSectionId en el useEffect hasta que el
                            // revalidate incluya la sección recién creada.
                            justCreatedContextRef.current = true;
                          }
                          formData.set("sectionId", sectionIdToUse);
                          const result = await addQuestionAction({}, formData);
                          // Sincronizar targetSectionId con la verdad del
                          // servidor (ago 2026, pedido del docente: usar el
                          // sectionId real del response).
                          if (result.success) {
                            if (result.sectionId) setTargetSectionId(result.sectionId);
                            // En modo "Sin contexto" el bloque Contexto está
                            // oculto, así que NO llamamos setContextSaved(true):
                            // no hay nada que bloquear visualmente. El toast
                            // se dispara igual para confirmar el guardado.
                            notifyItemSaved();
                          }
                          return result;
                        }
                        // BUG FIX: si el draft ya coincide con la sección
                        // destino (caso típico tras un "Agregar enunciado"
                        // anterior que dejó el contexto precargado), NO crear
                        // sección nueva — la pregunta va a la sección destino
                        // tal cual. Sin esto, la 2ª pregunta con el mismo
                        // contexto creaba una sección duplicada vacía.
                        const targetSection = data.sections.find((s) => s.id === targetSectionId);
                        // CASO "primera pregunta de la evaluación": no hay
                        // ninguna sección aún (`data.sections.length === 0` →
                        // `targetSectionId === null`). El docente debe poder
                        // escribir enunciado + opciones sin que un useEffect
                        // le cree una sección fantasma al cargar. Aquí
                        // creamos la sección con el draft del docente
                        // (título/contenido si los escribió) y luego
                        // persistimos la pregunta en esa sección. (ago 2026,
                        // pedido del docente: el contexto se crea al
                        // pulsar "Agregar enunciado", "Nuevo contexto" o
                        // "Guardar" — no antes.)
                        if (!targetSectionId && data.sections.length === 0) {
                          console.log("[override] Branch 1 (length===0)");
                          const createFd = new FormData();
                          createFd.append("evaluationId", data.evaluationId);
                          // FIX (ago 2026): usa los valores leídos del DOM
                          // (`orchestratorTitle` / `orchestratorContentRaw`)
                          // en vez de React state.
                          if (orchestratorTitle.length > 0) {
                            createFd.append("title", orchestratorTitle);
                          }
                          if (orchestratorContentRaw) {
                            createFd.append("content", orchestratorContentRaw);
                          }
                          const created = await addSectionAction({}, createFd);
                          if (!created.success || !created.sectionId) {
                            setFormError(created.error ?? "No se pudo crear la sección inicial.");
                            setActionStatus("error");
                            return created;
                          }
                          formData.set("sectionId", created.sectionId);
                          setTargetSectionId(created.sectionId);
                          // FIX (ago 2026, bug del docente): acabamos
                          // de crear una sección nueva y aún no ha
                          // llegado el revalidate. Si el `useEffect`
                          // de sincronización corre con `data.sections`
                          // stale, reasignaría `targetSectionId` a la
                          // última sección del array (la previa, C8)
                          // y el snapshot de "Editar contexto" +
                          // "Cancelar" revertiría a C8. El ref se
                          // limpia en el `useEffect` cuando
                          // `data.sections` ya contiene la sección.
                          justCreatedContextRef.current = true;
                          const result = await addQuestionAction({}, formData);
                          if (result.success) {
                            if (result.sectionId) setTargetSectionId(result.sectionId);
                            // El contexto (recién creado con el draft del
                            // docente) quedó persistido → bloqueamos el
                            // bloque Contexto y mostramos "Editar contexto"
                            // como única salida. (ago 2026, pedido del
                            // docente).
                            setContextSaved(true);
                            notifyItemSaved();
                          }
                          return result;
                        }
                        // targetSection existe → evaluar si REUSAR o completar
                        // la vacía. El id es la verdad sólo cuando la
                        // sección destino YA tiene contenido persistido
                        // (ago 2026, pedido del docente).
                        //
                        // Excepción crítica (ago 2026, bug reportado): si la
                        // sección destino está VACÍA y el docente tipeó
                        // algo en el bloque Contexto, NO reusamos tal cual
                        // — caeríamos al mismo caso de abajo ("rename-empty"
                        // / "create-new") pero saltándonos la propagación
                        // del draft. Consecuencia: la pregunta se guardaba
                        // en una sección sin título. Caso típico: tras
                        // "Nuevo contexto" sin tipear nada, queda una
                        // sección vacía y `targetSectionId` se reasigna a
                        // ella por el effect de auto-asignación. Si el
                        // docente luego escribe título + descripción y
                        // pulsa "Agregar enunciado", el draft debe poblar
                        // la sección vacía, no descartarse.
                        // Narrowing: targetSection puede ser undefined
                        // porque `Array.prototype.find` lo tipa así.
                        if (targetSection) {
                          const targetIsEmpty = !targetSection.title && !targetSection.content;
                          // FIX (ago 2026): usa los valores leídos del DOM
                          // (`orchestratorTitle` / `orchestratorContent`) en
                          // vez de React state, para no perder el último
                          // keystroke.
                          const draftIsUnsaved = hasUnsavedContexto(
                            orchestratorTitle,
                            orchestratorContent,
                          );
                          // FIX (ago 2026, bug del docente): el REUSE debe
                          // considerar si el docente tipeó un título NUEVO.
                          // Si el título del draft difiere del título de la
                          // sección destino, el docente quiere CREAR una
                          // sección nueva, NO reusar la destino. Caso típico
                          // del bug: tras "Nuevo contexto" sin tipear título,
                          // queda una sección vacía de título pero con
                          // contenido (heredado del docente que tipeó
                          // contenido); el `useEffect` (línea 326)
                          // auto-asigna `targetSectionId` a esa sección
                          // huérfana; cuando el docente luego escribe un
                          // título nuevo (C2) y pulsa "Agregar enunciado",
                          // el orquestador REUSABA la sección destino (sin
                          // título) y el ítem quedaba con NINGUNO.
                          //
                          // Reglas nuevas:
                          //   - Draft completamente vacío → REUSE.
                          //   - Draft con título vacío → REUSE (solo refinó
                          //     contenido, sin contexto nuevo).
                          //   - Draft con título igual al destino → REUSE
                          //     (refinó contenido manteniendo el contexto).
                          //   - Draft con título diferente al destino →
                          //     NO REUSE, crear sección nueva.
                          const draftTitleDiffersFromTarget =
                            orchestratorTitle !== (targetSection.title ?? "");
                          const shouldReuse =
                            !draftIsUnsaved ||
                            orchestratorTitle === "" ||
                            !draftTitleDiffersFromTarget;
                          // TEMP DEBUG
                          console.log("[override] Branch 2 REUSE check", {
                            targetSectionId: targetSection.id,
                            targetTitle: targetSection.title,
                            targetIsEmpty,
                            draftIsUnsaved,
                            draftTitle: orchestratorTitle,
                            draftTitleDiffersFromTarget,
                            shouldReuse,
                          });
                          // REUSAR sólo si la sección destino YA TIENE
                          // contenido Y el título del draft coincide (o
                          // está vacío). Si el docente tipeó un título
                          // diferente, caemos al legacy (rename-empty /
                          // create-new) que propaga el draft del docente.
                          if (shouldReuse) {
                            const result = await addQuestionAction({}, formData);
                            if (result.success) {
                              // Sincronizar targetSectionId con la verdad
                              // del servidor. (ago 2026)
                              if (result.sectionId) setTargetSectionId(result.sectionId);
                              // El contexto (de la sección destino) quedó persistido
                              // junto con la pregunta → bloqueamos el bloque
                              // Contexto y mostramos "Editar contexto" como única
                              // salida. (ago 2026)
                              setContextSaved(true);
                              notifyItemSaved();
                            }
                            return result;
                          }
                        }
                        // Decide: ¿renombrar la sección vacía auto-creada, o
                        // crear una nueva sección? Renombrar evita el caso
                        // "queda una sección fantasma vacía al inicio". Si hay
                        // 2+ secciones, O si la única sección ya tiene
                        // título/contenido, creamos nueva.
                        //
                        // IMPORTANTE (ago 2026, pedido del docente): ya NO
                        // deduplicamos por título. Si el docente escribe un
                        // título que coincide con el de una sección existente
                        // (que NO es la sección destino), eso puede ser
                        // casualidad o contexto repetido legítimo — pero NO
                        // debemos asumir que el docente quiere reutilizar esa
                        // sección. El id del contexto destino es la verdad y
                        // se preserva explícitamente vía `targetSectionId` /
                        // `editingOriginalSectionIdRef`. La única rama de
                        // re-uso de sección existente es la de arriba
                        // (`contextoMatchesSection` contra `targetSection`),
                        // que compara por id + contenido.
                        //
                        // Histórico: las 3 defensas que existían contra
                        // duplicados por título (jul-ago 2026) ya no aplican
                        // porque reusamos por id, no por título:
                        //   1. Race condition entre revalidate y submit
                        //      (sections stale) → SIN EFECTO: ahora no
                        //      buscamos por título.
                        //   2. StrictMode dobla el useEffect de auto-creación
                        //      → SIN EFECTO: el useEffect de auto-creación
                        //      ya se eliminó (ago 2026).
                        //   3. Doble click del docente → SIN EFECTO: la
                        //      rama que coincidía con la sección recién
                        //      creada se cubre vía
                        //      `contextoMatchesSection(targetSection)`, no
                        //      por título.
                        const onlySection = data.sections.length === 1 ? data.sections[0] : null;
                        const isEmpty =
                          onlySection !== null &&
                          onlySection !== undefined &&
                          !onlySection.title &&
                          !onlySection.content;
                        if (isEmpty && onlySection) {
                          console.log("[override] Branch 3 (rename-empty)", {
                            onlySectionId: onlySection.id,
                            orchestratorTitle,
                          });
                          const fd = new FormData();
                          fd.append("evaluationId", data.evaluationId);
                          fd.append("sectionId", onlySection.id);
                          // FIX (ago 2026): usa los valores leídos del DOM
                          // (`orchestratorTitle` / `orchestratorContentRaw`)
                          // en vez de React state.
                          fd.append("title", orchestratorTitle);
                          if (orchestratorContentRaw) {
                            fd.append("content", orchestratorContentRaw);
                          }
                          const res = await updateSectionAction({}, fd);
                          if (res.error) return res;
                          // sectionId no cambia: la pregunta va a la misma
                          // sección (ahora con título/contenido).
                          //
                          // FIX (ago 2026, bug del docente): pero el `sectionId` que
                          // ve `addQuestionAction` viene del `formData` del
                          // QuestionForm (hidden input alimentado por la prop
                          // `sectionId={targetSectionId ?? ""}`). Si el docente llegó
                          // a este branch con `targetSectionId=null` (caso típico:
                          // tras "Nuevo contexto" con enunciado vacío, el orquestador
                          // limpia drafts y pone targetSectionId=null; el QuestionForm
                          // se remonta con `sectionId=""`), el `addQuestionAction`
                          // siguiente recibiría `sectionId=""` y la pregunta se
                          // perdería. Sincronizamos formData y state con el id real,
                          // igual que hace la rama de creación inicial arriba (línea
                          // 1651).
                          formData.set("sectionId", onlySection.id);
                          setTargetSectionId(onlySection.id);
                        } else {
                          // FIX ago 2026 (revertido/recuperado ago 2026):
                          // el draft del docente, cuando NO coincide con la
                          // sección destino, representa un contexto NUEVO
                          // que el docente está construyendo desde el
                          // form. Lo creamos como sección nueva en vez de
                          // pisar la sección destino.
                          //
                          // Caso típico (bug reportado ago 2026):
                          //   1. El docente pulsa "Nuevo contexto" (que crea
                          //      la sección B y deja targetSectionId=null;
                          //      el effect de fallback lo termina
                          //      reasignando a B).
                          //   2. El docente tipa un nuevo título/contenido
                          //      en el form (otro contexto distinto a B).
                          //   3. Pulsa "Agregar enunciado".
                          //   4. (antes de este fix) updateSectionAction
                          //      actualizaba B con el nuevo draft → la
                          //      sección recién creada se sobrescribía con
                          //      un contexto que el docente nunca pidió
                          //      para ella, y el contexto "anterior"
                          //      quedaba perdido.
                          //   5. (ahora) addSectionAction crea una
                          //      sección C con el draft nuevo, y la
                          //      pregunta va a C. La sección B queda
                          //      intacta con su contexto original.
                          //
                          // Nota: el commit f4a6e28 había invertido esta
                          // rama a updateSectionAction argumentando que
                          // "Agregar enunciado" siempre debe actualizar
                          // la sección destino. En retrospectiva eso solo
                          // es cierto cuando el draft ES una edición
                          // menor de la sección destino (típico: el
                          // docente refina el título) — pero el form no
                          // distingue "edición menor" de "contexto
                          // nuevo", y cuando el docente viene de "Nuevo
                          // contexto" la sección destino es justamente
                          // la que él NO quiere tocar. Recuperamos la
                          // rama de creación como comportamiento por
                          // defecto; si en el futuro se necesita
                          // "editar contexto de la sección actual"
                          // tendremos que añadir una acción explícita
                          // (botón "Editar contexto" o similar) que no
                          // se confunda con la creación de ítems.
                          const fd = new FormData();
                          fd.append("evaluationId", data.evaluationId);
                          // FIX (ago 2026, bug del docente): usa los valores
                          // leídos del DOM (`orchestratorTitle` /
                          // `orchestratorContentRaw`) en vez de React state.
                          // Esta es la rama que se ejecutaba en el bug
                          // reportado por el docente: tras "Nuevo contexto"
                          // con enunciado escrito, `targetSectionId` queda
                          // null y `data.sections.length >= 2`, así que caemos
                          // aquí. Si React aún no había aplicado el último
                          // keystroke del título/contenido, se creaba una
                          // sección sin título → el ítem quedaba con NINGUNO.
                          fd.append("title", orchestratorTitle);
                          if (orchestratorContentRaw) {
                            fd.append("content", orchestratorContentRaw);
                          }
                          // TEMP DEBUG (ago 2026): ver qué llega al server.
                          console.log("[override] Branch 4 addSection", {
                            sentTitle: orchestratorTitle,
                            sentContentLen: orchestratorContentRaw.length,
                            fdTitle: fd.get("title"),
                            fdContentLen: String(fd.get("content") ?? "").length,
                          });
                          const res = await addSectionAction({}, fd);
                          console.log("[override] Branch 4 addSection result", {
                            success: res.success,
                            error: res.error,
                            sectionId: res.sectionId,
                          });
                          if (res.error) return res;
                          if (res.sectionId) {
                            formData.set("sectionId", res.sectionId);
                            setTargetSectionId(res.sectionId);
                            // FIX (ago 2026, bug del docente): igual
                            // que en la rama de creación inicial,
                            // acabamos de crear una sección nueva y
                            // `data.sections` aún no la contiene. El
                            // ref se limpia en el `useEffect` cuando
                            // llega el revalidate. (Ver línea 1743
                            // para el caso análogo.)
                            justCreatedContextRef.current = true;
                          }
                        }
                        const result = await addQuestionAction({}, formData);
                        // FIX (ago 2026): dispara el toast directamente desde
                        // el overrideAction. El onDone del QuestionForm NO se
                        // está ejecutando consistentemente (probable bug del
                        // useEffect tras la cadena de revalidates), así que
                        // confiamos en el resultado del server action.
                        if (result.success) {
                          // Sincronizar targetSectionId con la verdad
                          // del servidor (ago 2026, pedido del docente:
                          // usar el sectionId real del response). Esto
                          // cubre el caso donde el servidor haya
                          // persistido la pregunta en una sección
                          // distinta a la que el cliente envió.
                          if (result.sectionId) setTargetSectionId(result.sectionId);
                          // El contexto (recién creado o coincidente con
                          // el destino) quedó persistido → bloqueamos el
                          // bloque Contexto y mostramos "Editar contexto"
                          // como única salida. (ago 2026, pedido del
                          // docente).
                          setContextSaved(true);
                          notifyItemSaved();
                        }
                        return result;
                      } finally {
                        submittingRef.current = false;
                      }
                    }}
                    // Una sola cadena de acciones a la derecha del submit:
                    // [Guardar] [Cancelar]. "Nuevo contexto" se renderiza
                    // en `extraActionsLeft` (la contraparte izquierda de
                    // este slot) para alinearse horizontalmente con submit/
                    // Guardar/Cancelar pero a la IZQUIERDA. Pedido del
                    // docente (ago 2026: "que aparezca a principio pero en
                    // la misma linea horizontal de los demas botones").
                    //
                    // - "Guardar" y "Cancelar" se muestran SIEMPRE — incluso
                    //   en creación, donde "Guardar" reusa el submit del form
                    //   (atajo equivalente al botón principal) y "Cancelar"
                    //   limpia los borradores sin guardar.
                    //
                    // Orden final de la fila (alineado por `justify-between`):
                    //   [Nuevo contexto?]    [Agregar enunciado] [Guardar] [Cancelar]
                    // donde "Nuevo contexto" solo aparece en modo creación.
                    extraActions={
                      <>
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
                            // Reset del modo "Sin contexto" al descartar la
                            // card de creación: si el docente re-abre con
                            // "Con Contexto" desde el switcher, queremos
                            // que vea el bloque Contexto (no el modo
                            // sin-contexto residual del intento anterior).
                            setNoContextMode(false);
                          }}
                        >
                          Cancelar
                        </Button>
                      </>
                    }
                    // Cierre optimista del card cuando el botón submitido
                    // trae `data-close-on-save="true"` (p.ej. "Guardar").
                    // Se dispara DENTRO del `onSubmit` del QuestionForm, no
                    // desde `onDone`, porque el `useEffect` de
                    // `state.success` no se vuelve a correr de forma
                    // consistente tras las revalidates encadenadas y el
                    // card quedaba abierto en la primera carga. (ago 2026,
                    // bug reportado: "porque el boton guardar no cierra
                    // el card del item la primera vez?").
                    onWillClose={() => {
                      setShowForm(false);
                    }}
                    onDone={(info) => {
                      // Al guardar exitosamente: limpiamos el modo edición.
                      setEditingQuestionId(null);
                      setShowEditingBanner(false);
                      setActionStatus("saved");
                      // El toast de éxito "El ítem fue guardado de manera
                      // correcta" se dispara desde el overrideAction (no
                      // desde aquí), porque el useEffect del QuestionForm
                      // que invoca onDone NO corre consistentemente cuando
                      // hay revalidates encadenadas (ver commit del fix).
                      // Si el docente había desbloqueado el contexto
                      // antes de guardar la pregunta, también limpiamos
                      // ese flag — ya no estamos en modo edición de
                      // pregunta, así que el botón "Editar contexto"
                      // tampoco aplica.
                      setEditingContext(false);
                      // En modo creación, marcar el contexto como
                      // guardado para que el bloque Contexto quede
                      // BLOQUEADO y aparezca el botón "Editar contexto"
                      // como única salida. (ago 2026, pedido del
                      // docente). En modo edición (editingQuestionId
                      // aún era !== null al disparar onDone, pero ya
                      // lo pusimos en null arriba) la marca de bloqueo
                      // por guardado se mantiene — el docente sigue
                      // viendo el botón "Editar contexto" si estaba
                      // desbloqueado.
                      if (!editingQuestionId) {
                        setContextSaved(true);
                      }
                      // IMPORTANTE: NO limpiamos draftSectionTitle ni
                      // draftSectionContent tras un "Agregar enunciado"
                      // exitoso. El docente espera ver el contexto
                      // PRECARGADO arriba para que el próximo click guarde
                      // la pregunta con el mismo contexto (reusando la
                      // sección destino) sin crear una sección nueva.
                      //
                      // El orquestador del overrideAction compara el draft
                      // contra la sección destino vía contextoMatchesSection:
                      //  - si el docente NO cambió nada (mismo título),
                      //    coincide → reusa.
                      //  - si cambió el título, no coincide → crea nueva.
                      //
                      // El QuestionForm.reset() interno limpia enunciado,
                      // opciones y clave (inputs del form de pregunta, NO
                      // los inputs del contexto).
                      //
                      // En modo edición NO tocamos nada: el padre cierra
                      // el formulario y se sale del flujo de creación.
                      //
                      // El cierre del card por `data-close-on-save="true"`
                      // ahora vive en `onWillClose` (más arriba), que se
                      // dispara desde `onSubmit` antes del server action —
                      // es la ruta fiable (la del `useEffect` de
                      // `state.success` falla tras revalidates encadenadas,
                      // bug confirmado en ago 2026). El flag legacy
                      // `info?.close` se mantiene como red de seguridad
                      // por si un padre aún no pasó `onWillClose`.
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
          Aún no hay ítems registrados. Para crear uno, selecciona una de las opciones anteriores.
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
                  <th className="px-4 py-3 text-center font-medium">DESCRIPCIÓN</th>
                  <th className="px-4 py-3 text-center font-medium">CONTEXTO</th>
                  <th className="px-4 py-3 text-center font-medium">OPCIONES</th>
                  <th className="px-4 py-3 text-center font-medium">CLAVE</th>
                  <th className="px-4 py-3 text-center font-medium">ACCIONES</th>
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
                      <td className="px-4 py-2 text-center">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Eliminar ítem ${q.number}`}
                          title="Eliminar ítem"
                          // stopPropagation para que el click no abra el modal
                          // de revisión (la fila tiene onClick → setReviewModal).
                          onClick={(e) => {
                            e.stopPropagation();
                            const ok = window.confirm(
                              `Se eliminará el ítem ${q.number} y los siguientes se renumerarán. Esta acción no se puede deshacer.`,
                            );
                            if (!ok) return;
                            const fd = new FormData();
                            fd.append("evaluationId", data.evaluationId);
                            fd.append("questionId", q.id);
                            void deleteQuestionAction({}, fd);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* BOTÓN STICKY AL FINAL — mismo CTA que el header, anclado abajo para
          que el docente no tenga que scrollear hacia arriba cuando la tabla
          tiene muchos ítems. Mismas condiciones de visibilidad (DRAFT +
          editable + items > 0). El card usa position: sticky + bottom-4
          para que flote sobre el contenido al hacer scroll hasta el final.
          El z-20 garantiza que no quede tapado por otros sticky del repo. */}
      {data.editable && items.length > 0 && data.evaluationStatus === "DRAFT" ? (
        <div className="sticky bottom-4 z-20 flex justify-end">
          <div className="bg-card flex items-center gap-3 rounded-xl border-2 border-black p-3 shadow-lg dark:border-white">
            <p className="text-muted-foreground text-xs">
              Cuando concluya con la formulación de este bloque de ítems, publíquelos como versión
              final.
            </p>
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => {
                void handlePublish();
              }}
              disabled={publishingRef.current}
              title="Publicar la formulación como versión final"
            >
              <Send className="mr-1 h-3.5 w-3.5" /> Publicar formulación
            </Button>
          </div>
        </div>
      ) : null}

      {/* MODAL DE REVISIÓN */}
      {reviewModal
        ? (() => {
            const modalSection = data.sections.find((s) => s.id === reviewModal.sectionId);
            return (
              <ReviewModal
                question={reviewModal}
                context={
                  modalSection
                    ? { title: modalSection.title ?? null, content: modalSection.content ?? null }
                    : null
                }
                evaluationId={data.evaluationId}
                editable={data.editable}
                onClose={() => setReviewModal(null)}
                onEdit={() => startEdit(reviewModal)}
              />
            );
          })()
        : null}
    </div>
  );
}
