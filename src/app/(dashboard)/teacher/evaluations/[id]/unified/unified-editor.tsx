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
import { contextoMatchesSection, hasUnsavedContexto } from "./save-contexto";

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
  //  - Camino `?from=list` (docente llega desde "Mis formulaciones"):
  //    PRIMER placeholder vacío (la sección auto-creada por StrictMode,
  //    sin título ni contenido). El docente suele entrar a la card a
  //    CREAR un contexto nuevo, no a refinar uno existente — y si
  //    apuntamos a la última sección con contenido, el gate
  //    `sectionHasSavedContent` se evalúa a true y los botones
  //    "Actualizar/Cancelar" emergen falsamente al tipear sobre un
  //    input que arranca vacío (mismatch entre la intención del docente
  //    y la sección destino). Apuntando al placeholder vacío, el gate
  //    queda false hasta que el docente efectivamente escriba algo
  //    distinto, y los botones solo aparecen si apunta a una sección
  //    con contenido real (lo cual ya no es este caso por construcción).
  //    Si NO hay placeholder vacío (todas las secciones tienen
  //    contenido), caemos a `data.sections[0]` (primera por order) para
  //    no dejar `targetSectionId=null` (eso mostraría "Preparando el
  //    formulario…" indefinidamente, mala UX).
  const [targetSectionId, setTargetSectionId] = useState<string | null>(() => {
    if (data.initialHideForm) {
      const empty = data.sections.find((s) => !s.title && !s.content);
      if (empty) return empty.id;
      return data.sections[0]?.id ?? null;
    }
    return data.sections[data.sections.length - 1]?.id ?? data.sections[0]?.id ?? null;
  });

  // Estado del contexto a crear.
  const [draftSectionTitle, setDraftSectionTitle] = useState("");
  const [draftSectionContent, setDraftSectionContent] = useState<unknown>(null);
  // Marca si el docente tocó los inputs de título/contenido del bloque
  // "Contexto". El botón "Actualizar contexto" solo aparece cuando
  // dirty=true (ago 2026). Sin esta marca, en el mount inicial
  // drafts="" pero la sección destino tiene contenido → diff falso → los
  // botones aparecen sin que el docente haya editado nada. Con la marca,
  // los inputs arrancan vacíos (lo que el docente espera al pulsar
  // "Agregar 1 a 1") y los botones solo emergen tras una edición real.
  // Se resetea a false tras "Actualizar contexto" / "Cancelar cambios" /
  // "Nuevo contexto" / startEdit (los flujos donde los drafts vuelven a
  // coincidir con el estado persistido o recién creado).
  const [contextoDirty, setContextoDirty] = useState(false);
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
  // Marca cuando ya disparamos la auto-creación de la sección inicial. Evita
  // loops si el addSectionAction regresa error y necesitamos reintentar.
  const autoCreatedRef = useRef(false);

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
    if (!targetSectionId || !data.sections.some((s) => s.id === targetSectionId)) {
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
  }, [data.sections, targetSectionId]);

  // Cuando el status pasa a PUBLISHED, liberamos el flag de publicación por
  // si quedó enganchado (p.ej. la promesa tiró excepción justo cuando llegó
  // el revalidate, y nunca se ejecutó el finally del publishHandler).
  useEffect(() => {
    if (data.evaluationStatus === "PUBLISHED") {
      publishingRef.current = false;
    }
  }, [data.evaluationStatus]);

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
    // Los drafts se sincronizaron con la sección persistida → no hay edición
    // pendiente. Los botones "Actualizar/Cancelar" deben quedar ocultos.
    setContextoDirty(false);
    // Entramos al modo edición de pregunta con el contexto BLOQUEADO por
    // default (mostramos el botón "Editar contexto", NO los inputs ya
    // habilitados). Defensivo: si el docente había entrado en modo edición
    // de contexto antes (improbable, pero posible si re-carga la misma
    // pregunta), reseteamos a false para arrancar limpio.
    setEditingContext(false);
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

      // DEFENSIVE DEDUPE (jul-ago 2026): si ya existe una sección con el
      // mismo título (trim case-insensitive) que el draft, NO creamos otra —
      // el backend (AddSection) no deduplica por título, así que esta es la
      // única barrera. Si la sección existente está VACÍA, la renombramos.
      // Si tiene contenido, reusamos sin más (sincronizamos drafts con la
      // sección destino).
      const matchingByTitle =
        title.length > 0
          ? data.sections.find((s) => (s.title ?? "").trim().toLowerCase() === title.toLowerCase())
          : null;

      if (matchingByTitle) {
        const isExistingEmpty = !matchingByTitle.title && !matchingByTitle.content;
        if (isExistingEmpty) {
          const fd = new FormData();
          fd.append("evaluationId", data.evaluationId);
          fd.append("sectionId", matchingByTitle.id);
          fd.append("title", title);
          if (hasContent) fd.append("content", contentRaw);
          const renameRes = await updateSectionAction({}, fd);
          if (renameRes.error) {
            setFormError(renameRes.error);
            setActionStatus("error");
            return;
          }
        }
        // Sección ya tiene el título (o lo acabamos de poner): nada que
        // crear. Apuntamos `targetSectionId` a la sección existente y
        // sincronizamos drafts con sus valores. Mismo principio que en
        // el camino de creación nuevo (ago 2026): drafts == sección →
        // sin diff → botones "Actualizar/Cancelar" quedan ocultos hasta
        // que el docente EDITE el contexto.
        setTargetSectionId(matchingByTitle.id);
        setDraftSectionTitle(title);
        if (hasContent) {
          try {
            setDraftSectionContent(JSON.parse(contentRaw));
          } catch {
            setDraftSectionContent(null);
          }
        } else {
          setDraftSectionContent(null);
        }
        setNewSectionRenderKey((k) => k + 1);
        setActionStatus("saved");
        newSectionFormRef.current?.reset();
        // Drafts sincronizados con la sección destino → no hay edición
        // pendiente que mostrar.
        setContextoDirty(false);
        // La sección destino ya tenía id guardado (era la razón del
        // dedupe), así que el bloque Contexto queda como está —
        // contextoDirty=false cierra los botones Actualizar/Cancelar y
        // los inputs siguen habilitados (cualquier edición futura los
        // reabre automáticamente vía `setContextoDirty(true)`).
        setTimeout(() => {
          setActionStatus((cur) => (cur === "saved" ? "idle" : cur));
        }, 2500);
        notifyItemSaved();
        return;
      }

      // Decisión: ¿hay exactamente 1 sección vacía? Si sí, RENOMBRAR.
      // Si no, CREAR nueva.
      const onlySection = data.sections.length === 1 ? data.sections[0] : null;
      const isEmpty =
        onlySection !== null &&
        onlySection !== undefined &&
        !onlySection.title &&
        !onlySection.content;

      let res: AdminFormState;
      let newSectionId: string | null = null;
      if (isEmpty && onlySection) {
        // RENOMBRAR: construimos un FormData con sectionId para
        // updateSectionAction.
        newSectionId = onlySection.id;
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
        const createRes = await addSectionAction({}, fd);
        if (createRes.sectionId) newSectionId = createRes.sectionId;
        res = createRes;
      }

      if (res?.error) {
        setFormError(res.error);
        setActionStatus("error");
        return;
      }

      // Éxito: sincronizamos drafts con la sección recién creada (o
      // renombrada) en vez de limpiarlos. Si los drafts quedaran en ""
      // y la sección tuviera título="C2", el comparador del botón
      // "Actualizar contexto" vería un diff falso y los botones
      // aparecerían innecesariamente — el docente acaba de CREAR ese
      // contexto, no de editarlo. Manteniendo drafts == sección, el
      // botón queda oculto hasta que el docente EDITE algo. (ago 2026)
      //
      // Además: apuntamos `targetSectionId` directamente a la nueva
      // sección, en lugar de dejarlo en null. El effect de "sección
      // objetivo inválida" lo re-asignaría al mismo id de todos modos
      // (es la última sección), pero hacerlo explícito evita el ciclo.
      // Replica también el comportamiento post-"Agregar enunciado"
      // (drafts pre-cargados con el contexto recién persistido): la
      // próxima pregunta del docente reutilizará esta sección vía
      // `contextoMatchesSection` en el overrideAction.
      if (newSectionId) {
        setTargetSectionId(newSectionId);
        setDraftSectionTitle(title);
        if (hasContent) {
          try {
            setDraftSectionContent(JSON.parse(contentRaw));
          } catch {
            setDraftSectionContent(null);
          }
        } else {
          setDraftSectionContent(null);
        }
      }
      setNewSectionRenderKey((k) => k + 1);
      setActionStatus("saved");
      newSectionFormRef.current?.reset();
      // Drafts sincronizados con la sección recién creada → no hay edición
      // pendiente.
      setContextoDirty(false);
      // El bloque Contexto sigue habilitado; contextoDirty=false oculta
      // los botones Actualizar/Cancelar. Si el docente quiere ajustar
      // lo recién guardado, tipea y los botones reaparecen
      // automáticamente vía setContextoDirty(true) en el onChange.
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
    const sectionId = targetSectionId;
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
      // Los drafts quedaron persistidos → ya coinciden con la sección
      // destino. Limpiamos la marca dirty para que el botón
      // "Actualizar contexto" desaparezca (el docente acaba de guardar,
      // no hay más diff que mostrar).
      setContextoDirty(false);
      // Si guardamos el contexto desde el flujo "Editar contexto"
      // (edición de pregunta existente), cerramos también ese flag para
      // devolver el bloque al estado default — inputs bloqueados,
      // docente sigue enfocado en editar la pregunta. En el otro flujo
      // (no-editingQuestion), `editingContext` ya era false así que el
      // setter es no-op.
      if (editingContext) setEditingContext(false);
      // Persistimos cambios del contexto. contextoDirty=false cierra
      // los botones Actualizar/Cancelar; los inputs siguen habilitados
      // para que el docente pueda seguir editando sin re-entradas.
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
    const sectionId = targetSectionId;
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
    // Tras revertir, los drafts coinciden con la sección destino → no
    // hay diff → no hay botones (controlado por contextoDirty=false).
    setContextoDirty(false);
    // Si estábamos en el flujo "Editar contexto" desde un modo edición
    // de pregunta, también cerramos ese flag para volver al estado
    // default (inputs bloqueados de nuevo, listo para tipear la
    // pregunta sin tocar el contexto por accidente).
    if (editingContext) setEditingContext(false);
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
      // El docente descartó el nuevo contexto antes de tipear nada —
      // cualquier botón "Actualizar contexto" / "Cancelar cambios" debe
      // quedar oculto porque la intención no fue editar, fue descartar.
      setContextoDirty(false);
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

      // PASO 2: crear la nueva sección (o renombrar la vacía inicial)
      // con el título/contenido del bloque "Contexto" arriba. Esta
      // sección es la que recibirá la PRÓXIMA pregunta, no la que
      // acabamos de guardar.
      //
      // Única excepción: si la evaluación tiene UNA SOLA sección vacía
      // (caso típico del auto-crear inicial en StrictMode), la
      // renombramos en vez de crear una segunda — para evitar el bug
      // clásico de "dos secciones iniciales vacías". En ese caso la
      // sección actual (que ya tiene la pregunta recién guardada) es
      // la que recibe el título/contenido, y `targetSectionId` no se
      // mueve (la siguiente pregunta iría a la misma sección, lo cual
      // es coherente: el docente aún no tiene dos contextos distintos
      // separados).
      const onlySection = data.sections.length === 1 ? data.sections[0] : null;
      const isEmpty =
        onlySection !== null &&
        onlySection !== undefined &&
        !onlySection.title &&
        !onlySection.content;
      let newSectionId: string | null = null;
      if (isEmpty && onlySection) {
        newSectionId = onlySection.id;
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
        // Crear sección nueva SIEMPRE — sin dedupe por título. Si el
        // docente titula esta "C2" y ya existe otra "C2", es decisión
        // suya: el botón "Nuevo contexto" literalmente pidió un contexto
        // nuevo, no implícitamente pidió reusar uno existente.
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
        if (!res.sectionId) {
          setFormError("No se pudo crear el nuevo contexto.");
          setActionStatus("error");
          return;
        }
        newSectionId = res.sectionId;
      }

      // PASO 3: apuntar `targetSectionId` a la sección recién creada y
      // sincronizar los drafts con su contenido (ago 2026).
      //
      // Por qué NO seteamos `targetSectionId = null`: el `useEffect` de
      // "sección objetivo inválida" lo re-asignaría automáticamente a la
      // última sección (= la recién creada) en el siguiente render, así
      // que el null era inútil y rompía el modelo mental del orquestador.
      // Asignamos el id directamente y evitamos el ciclo.
      //
      // Por qué NO limpiamos los drafts: el botón "Actualizar contexto"
      // compara drafts contra la sección destino. Si drafts="" y la
      // sección tiene título="C2", ve un diff falso y aparece el botón
      // innecesariamente. Manteniendo los drafts sincronizados con la
      // sección recién creada, drafts == sección → no hay diff → el
      // botón queda oculto. Esto además replica el comportamiento de
      // "Agregar enunciado" (drafts pre-cargados) y muestra al docente
      // exactamente lo que acaba de guardar — UX más coherente.
      //
      // Implementación:
      //  - setTargetSectionId(newSectionId): apunta a la nueva sección.
      //  - setDraftSectionTitle/Content: mantienen el título y el JSON
      //    parseado del contenido (no string crudo) para que el Input y
      //    el RichTextEditor del bloque "Contexto" sigan mostrando lo
      //    recién persistido.
      //  - setNewSectionRenderKey: bumpea la key para forzar el remount
      //    del Input/RichTextEditor (no controlados; sus `defaultValue`
      //    solo aplican al montar). Tras el remount, los inputs se ven
      //    con el título y contenido de la sección recién guardada.
      //  - questionForm.reset(): limpia enunciado + opciones del
      //    QuestionForm (siguiente pregunta arranca en blanco). El form
      //    del QuestionForm también limpia `correct`, `optionCount` y
      //    remonta el RichTextEditor del enunciado vía
      //    `clearCorrectAfterSave`.
      if (newSectionId) {
        setTargetSectionId(newSectionId);
        setDraftSectionTitle(title);
        if (hasContent) {
          try {
            setDraftSectionContent(JSON.parse(contentRaw));
          } catch {
            setDraftSectionContent(null);
          }
        } else {
          setDraftSectionContent(null);
        }
      }
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
      // Acabamos de persistir el nuevo contexto: lo que está en los drafts
      // YA es lo que está guardado. No hay diff real contra la sección
      // recién creada, así que contextoDirty vuelve a false. Si el docente
      // quiere editar el contexto recién creado, tendrá que tocar título o
      // contenido de nuevo, y eso setea contextoDirty=true como cualquier
      // otra edición.
      setContextoDirty(false);
      // Los inputs del bloque Contexto siguen habilitados y muestran
      // lo recién guardado (sincronizamos los drafts antes). Si el
      // docente quiere ajustar, tipea y contextoDirty=true habilita
      // los botones Actualizar/Cancelar.
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
          {/* "Agregar 1 a 1" solo aparece cuando el card de creación/edición
            está OCULTO. Cuando el card ya está visible, ese botón sería
            redundante (el docente ya está creando/editando) y genera la
            sensación de que hay dos modos paralelos. Al cerrar el card
            (guardando o cancelando) el botón reaparece. */}
          {!showForm ? (
            <Button type="button" size="sm" variant="default" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Agregar 1 a 1
            </Button>
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
                    setContextoDirty(true);
                  }}
                  // Input HABILITADO por defecto (ago 2026): el docente
                  // pidió tipear libremente sobre una formulación
                  // existente desde "Mis formulaciones" sin verse forzado
                  // a pulsar un botón "Editar contexto" primero. Solo se
                  // bloquea cuando la evaluación no es editable, o cuando
                  // estamos editando una pregunta existente Y el docente
                  // todavía no pulsó "Editar contexto" (en ese modo
                  // bloqueamos el contexto por defecto para evitar
                  // cambios simultáneos sobre ítem + contexto; el botón
                  // "Editar contexto" desbloquea vía `setEditingContext`).
                  disabled={!data.editable || (editingQuestionId !== null && !editingContext)}
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
                      setContextoDirty(true);
                    }}
                    // Misma regla que el Input del título (ago 2026):
                    // HABILITADO por defecto. Se bloquea solo cuando la
                    // evaluación no es editable o cuando estamos editando
                    // una pregunta existente SIN haber pulsado "Editar
                    // contexto" todavía. `disabled` mapea a
                    // `editable: false` dentro de TipTap y oculta
                    // Toolbar/controles.
                    disabled={!data.editable || (editingQuestionId !== null && !editingContext)}
                    minHeightClass="min-h-12"
                  />
                </div>
                {/* Botones de gestión del bloque Contexto (ago 2026).
                  Tres estados visuales mutuamente excluyentes:
                    (a) Edición de pregunta existente con contexto BLOQUEADO
                        (editingQuestionId && !editingContext) → botón único
                        "Editar contexto" para que el docente desbloquee.
                    (b) Edición de pregunta existente con contexto DESBLOQUEADO
                        (editingQuestionId && editingContext) o flujo normal
                        (!editingQuestionId) → "Actualizar/Cancelar" gated por
                        diff real entre drafts y sección persistida.
                    (c) Cualquier otro caso (sección vacía, no editable, sin
                        diff) → nada.

                  Por qué el botón (a) existe solo en modo edición de
                  pregunta: en el flujo normal "Mis formulaciones"
                  (b7bb2c7) los inputs nacen habilitados por default para
                  no forzar al docente a pulsar una entrada extra. Pero al
                  EDITAR una pregunta, los inputs sí están bloqueados
                  (riesgo de cambios accidentales sobre el contexto del
                  ítem mientras el docente solo quería editar el
                  enunciado), y entonces necesitamos el botón explícito
                  para entrar al modo edición del contexto. */}
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

                  // La sección destino debe tener contenido REAL guardado
                  // para que los botones de Actualizar/Cancelar tengan
                  // sentido (ago 2026). Si el `targetSection` existe
                  // (tiene id) pero está vacío (sin título ni contenido
                  // JSON), el docente NO está editando un contexto
                  // existente: el "contexto es nulo" desde la perspectiva
                  // del bloque. Aunque tipee, el resultado de "Agregar
                  // enunciado" será crear una sección nueva (vía la rama
                  // `else` del overrideAction en
                  // unified-editor.tsx:1525), no actualizar una vacía.
                  // Mostrar "Actualizar contexto" en ese caso sería
                  // engañoso: actualizaría una sección vacía para ponerle
                  // contenido nuevo, lo cual NO es la intención — el
                  // docente está construyendo un contexto fresh.
                  //
                  // Comprobamos: targetSection.title.trim() !== "" OR
                  // targetSection.content no es null/vacío según
                  // isTipTapEmpty. La sección placeholder auto-creada por
                  // StrictMode cae aquí (sin título y sin contenido).
                  const sectionHasSavedContent =
                    targetSection !== null &&
                    (sectionTitleTrimmed !== "" ||
                      (targetSection.content !== null &&
                        targetSection.content !== undefined &&
                        !isTipTapEmpty(targetSection.content)));

                  // (a) Edición de pregunta + contexto bloqueado
                  // → botón "Editar contexto". Único modo donde este
                  // botón aparece, para no contaminar el flujo normal
                  // (b7bb2c7) en el que el docente tipea libremente sobre
                  // la formulación sin pulsar entrada previa.
                  if (data.editable && editingQuestionId !== null && !editingContext) {
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={actionStatus === "saving"}
                          onClick={() => setEditingContext(true)}
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
                  //   2. NO estamos editando una pregunta existente SIN
                  //      haber desbloqueado el contexto (en ese modo los
                  //      inputs del contexto van disabled y la intención
                  //      del docente es editar el ítem, no el contexto).
                  //      Si el docente pulsó "Editar contexto"
                  //      (→editingContext=true), los botones SÍ se
                  //      muestran: es justamente ese flujo el que los
                  //      necesita.
                  //   3. Hay un targetSection con contenido real
                  //      guardado. Si la sección destino está vacía,
                  //      los botones no aplican (sería una creación, no
                  //      actualización).
                  //   4. contextoDirty=true: el docente tocó el bloque,
                  //      ya sea en este render o en uno previo sin
                  //      sincronizar.
                  //   5. Hay un diff real entre los drafts y el estado
                  //      guardado.
                  //
                  // contextoDirty es necesario porque en el mount inicial
                  // drafts="" pero la sección destino guardada tiene
                  // título/contenido → diff verdadero aunque el docente
                  // NO haya tocado nada. El flag se enciende en onChange
                  // del título o del RichTextEditor; se apaga en
                  // startEdit / handleUpdateContext OK /
                  // handleCancelContextEdit / handleAddOrRenameSection
                  // OK / handleNewContextWithQuestion OK o discard.
                  const showUpdateContextButton =
                    data.editable &&
                    (!editingQuestionId || editingContext) &&
                    sectionHasSavedContent &&
                    contextoDirty &&
                    (titleChanged || contentChanged);
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
            </section>

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
                    formRef={questionFormRef}
                    initial={editingInitial()}
                    createLabel="Agregar enunciado"
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
                      const willCreate =
                        hasUnsavedContexto(draftSectionTitle, draftSectionContent) &&
                        !contextoMatchesSection(
                          draftSectionTitle,
                          draftSectionContent,
                          data.sections.find((s) => s.id === targetSectionId),
                        );
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
                        const unsaved = hasUnsavedContexto(draftSectionTitle, draftSectionContent);
                        // BUG FIX: si el draft ya coincide con la sección
                        // destino (caso típico tras un "Agregar enunciado"
                        // anterior que dejó el contexto precargado), NO crear
                        // sección nueva — la pregunta va a la sección destino
                        // tal cual. Sin esto, la 2ª pregunta con el mismo
                        // contexto creaba una sección duplicada vacía.
                        const targetSection = data.sections.find((s) => s.id === targetSectionId);
                        if (
                          !unsaved ||
                          contextoMatchesSection(
                            draftSectionTitle,
                            draftSectionContent,
                            targetSection,
                          )
                        ) {
                          const result = await addQuestionAction({}, formData);
                          if (result.success) notifyItemSaved();
                          return result;
                        }
                        // Decide: ¿renombrar la sección vacía auto-creada, o
                        // crear una nueva sección? Renombrar evita el caso
                        // "queda una sección fantasma vacía al inicio". Si hay
                        // 2+ secciones, O si la única sección ya tiene
                        // título/contenido, creamos nueva.
                        //
                        // DEFENSIVE DEDUPE: si ya existe una sección con el
                        // mismo título (trim case-insensitive) que el draft,
                        // reusamos esa sección en vez de crear una nueva. El
                        // backend (AddSection) NO deduplica por título — cada
                        // llamada crea una fila nueva — así que esta
                        // comprobación client-side es la ÚNICA defensa contra
                        // duplicados por título. Cubre tres escenarios
                        // observados en bug reports (jul-ago 2026):
                        //   1. Click 1 crea C9; click 2 con draft="C9" cae en
                        //      `reuse` pero por race condition entre
                        //      revalidatePath y el segundo submit, el
                        //      orquestador evalúa contra `data.sections`
                        //      STALE (sin C9) y crea OTRA sección C9.
                        //   2. StrictMode de React dispara el useEffect de
                        //      auto-creación dos veces (en dev) y produce dos
                        //      secciones vacías iniciales; el orquestador ve
                        //      `data.sections.length === 2` y entra en
                        //      create-new en vez de rename-empty.
                        //   3. El docente pulsa "Agregar enunciado" dos
                        //      veces, pero el segundo submit llega antes del
                        //      revalidate → `data.sections` aún no incluye
                        //      C9 → crea C9 duplicado.
                        const trimmedDraftTitle = draftSectionTitle.trim();
                        const matchingByTitle =
                          trimmedDraftTitle.length > 0
                            ? data.sections.find(
                                (s) =>
                                  (s.title ?? "").trim().toLowerCase() ===
                                  trimmedDraftTitle.toLowerCase(),
                              )
                            : null;
                        if (matchingByTitle) {
                          console.log(
                            "[Agregar-enunciado] reusando sección existente por título (dédup)",
                            { sectionId: matchingByTitle.id, title: matchingByTitle.title },
                          );
                          formData.set("sectionId", matchingByTitle.id);
                          setTargetSectionId(matchingByTitle.id);
                          const result = await addQuestionAction({}, formData);
                          if (result.success) notifyItemSaved();
                          return result;
                        }
                        const onlySection = data.sections.length === 1 ? data.sections[0] : null;
                        const isEmpty =
                          onlySection !== null &&
                          onlySection !== undefined &&
                          !onlySection.title &&
                          !onlySection.content;
                        if (isEmpty && onlySection) {
                          const fd = new FormData();
                          fd.append("evaluationId", data.evaluationId);
                          fd.append("sectionId", onlySection.id);
                          fd.append("title", draftSectionTitle.trim());
                          if (draftSectionContent) {
                            fd.append("content", JSON.stringify(draftSectionContent));
                          }
                          const res = await updateSectionAction({}, fd);
                          if (res.error) return res;
                          // sectionId no cambia: la pregunta va a la misma
                          // sección (ahora con título/contenido).
                        } else {
                          // FIX ago 2026 (revertido/recuperado ago 2026):
                          // el draft del docente, cuando NO coincide con la
                          // sección destino Y NO matchea por título con
                          // ninguna existente, representa un contexto
                          // NUEVO que el docente está construyendo desde el
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
                          fd.append("title", draftSectionTitle.trim());
                          if (draftSectionContent) {
                            fd.append("content", JSON.stringify(draftSectionContent));
                          }
                          const res = await addSectionAction({}, fd);
                          if (res.error) return res;
                          if (res.sectionId) {
                            formData.set("sectionId", res.sectionId);
                            setTargetSectionId(res.sectionId);
                          }
                        }
                        const result = await addQuestionAction({}, formData);
                        // FIX (ago 2026): dispara el toast directamente desde
                        // el overrideAction. El onDone del QuestionForm NO se
                        // está ejecutando consistentemente (probable bug del
                        // useEffect tras la cadena de revalidates), así que
                        // confiamos en el resultado del server action.
                        if (result.success) {
                          notifyItemSaved();
                        }
                        return result;
                      } finally {
                        submittingRef.current = false;
                      }
                    }}
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
