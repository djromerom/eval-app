"use client";

/**
 * `<HtmlLiveEditor>` — editor HTML Live "estilo cargado" portada a React
 * (ago 2026).
 *
 * ## Origen
 *
 * Conversión a React del editor HTML Live dark que el docente cargó como
 * referencia. Conserva:
 *
 *   - Header oscuro con logo + toolbar
 *   - Toolbar: 📁 Abrir / 📋 Pegar / ✨ Ejemplo / ↺ Reset / Vista previa / ⬇ Exportar
 *   - Iframe interno (sandbox) que monta el HTML a editar
 *   - Walker que marca text nodes como `contenteditable` preservando estilos
 *   - Modal de pegado con textarea
 *   - Drag-drop de archivos `.html`
 *   - File picker
 *   - Toggle "Vista previa" (oculta marcadores de edición)
 *   - Export a `.html` (limpia nuestros markers `data-hle-*` y clase `hle-preview`)
 *   - Atajo Ctrl/Cmd+S para exportar
 *
 * ## Sustituye
 *
 * La versión previa (iframe-exterior + postMessage READY/INIT/SET_HTML/CHANGE)
 * queda eliminada. Ahora el editor es un componente React normal:
 *
 *   - Estado local con `useState` (filename, isPreviewMode, editableCount, pasteOpen)
 *   - `srcdoc={currentHtml}` declarativo (React re-monta el iframe en cambios)
 *   - `onChange(html)` para notificar al padre cuando el usuario edita
 *   - Helpers DOM puros a nivel de módulo (`injectEditorStyles`, `makeEditable`,
 *     `serializeForParent`) — no necesitan estado React
 *
 * ## State flow
 *
 *   Parent → Editor: `initialHtml` (HTML persistido del bundle)
 *   Editor → Parent: `onChange(html)` (debounced 250ms tras cada edición)
 *
 * El editor mantiene `currentHtml` interno que espeja lo que está en el
 * iframe. La sincronización entre lo que el usuario ve y lo que el padre
 * tiene en su hidden input fluye por `onChange`.
 *
 * ## Sandboxing
 *
 * El iframe usa `sandbox="allow-same-origin"` (sin `allow-scripts`) para
 * que el padre pueda leer `contentDocument` y aplicar el walker, pero
 * el HTML cargado no puede ejecutar JavaScript. La defensa-en-profundidad
 * real la hace `RenderCover` (DOMPurify) al renderizar el preview/PDF.
 */

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useFormStatus } from "react-dom";
import { SAMPLE_COVER_HTML } from "./sample-cover-html";
import { saveCoverHtmlAction, type CoverHtmlFormState } from "./actions";
import styles from "./html-live-editor.module.css";

export interface HtmlLiveEditorProps {
  /** HTML inicial (lo persistido del bundle). Vacío → arranca en empty state. */
  initialHtml: string;
  /** ID del bundle — necesario para `saveCoverHtmlAction`. */
  bundleId: string;
  /** false si el bundle está READY/PUBLISHED (deshabilita save). */
  editable: boolean;
}

// ---------------------------------------------------------------------------
// Helpers DOM puros (sin estado React). Viven a nivel de módulo para que
// sean fáciles de testear y no se recreen en cada render.
// ---------------------------------------------------------------------------

/**
 * Inyecta en el documento del iframe el CSS que marca visualmente los
 * nodos editables (outline dashed indigo) y los oculta en modo preview.
 * El tag lleva `data-hle-editor="true"` para que `serializeForParent`
 * lo pueda remover al exportar.
 */
function injectEditorStyles(doc: Document): void {
  const existing = doc.querySelector('style[data-hle-editor="true"]');
  if (existing) existing.remove();

  const style = doc.createElement("style");
  style.setAttribute("data-hle-editor", "true");
  style.textContent = [
    "[data-hle-editable], [data-hle-wrapper] {",
    "  outline: 1px dashed rgba(99, 102, 241, 0.55) !important;",
    "  outline-offset: 1px;",
    "  border-radius: 2px;",
    "  transition: outline-color .12s, background .12s;",
    "  cursor: text;",
    "  min-width: 1em;",
    "}",
    "[data-hle-editable]:hover, [data-hle-wrapper]:hover {",
    "  outline-color: #6366f1 !important;",
    "  background: rgba(99, 102, 241, 0.06) !important;",
    "}",
    "[data-hle-editable]:focus, [data-hle-wrapper]:focus {",
    "  outline: 2px solid #6366f1 !important;",
    "  background: rgba(99, 102, 241, 0.1) !important;",
    "}",
    "body.hle-preview [data-hle-editable],",
    "body.hle-preview [data-hle-wrapper] {",
    "  outline: none !important;",
    "  background: transparent !important;",
    "  cursor: default;",
    "}",
  ].join("\n");

  if (doc.head) {
    doc.head.appendChild(style);
  } else {
    doc.documentElement.insertBefore(style, doc.body);
  }
}

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TITLE",
  "META",
  "LINK",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
]);

/**
 * Recorre los text nodes del subtree y los marca como editables. Si el
 * padre tiene SOLO text nodes como hijos, se marca el padre entero
 * (más limpio para la edición). Si tiene mezcla (text + otros nodos),
 * cada text node se envuelve en un `<span data-hle-wrapper>` para que
 * `serializeForParent` lo pueda desenvolver al exportar.
 */
function makeEditable(root: Element): void {
  const doc = root.ownerDocument;
  if (!doc) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentNode;
      if (!parent || parent.nodeType !== 1) {
        return NodeFilter.FILTER_REJECT;
      }
      const tag = (parent as Element).nodeName;
      if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
      if ((parent as Element).closest("[data-hle-editable]")) {
        return NodeFilter.FILTER_REJECT;
      }
      if ((parent as Element).closest("script, style, noscript")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  const byParent = new Map<Element, Text[]>();
  for (const node of textNodes) {
    const p = node.parentNode as Element | null;
    if (p && p.nodeType === 1) {
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(node);
    }
  }

  for (const [parent, nodes] of byParent) {
    const onlyTextChildren = Array.from(parent.childNodes).every((c) => c.nodeType === 3);
    if (onlyTextChildren) {
      parent.setAttribute("contenteditable", "true");
      parent.setAttribute("data-hle-editable", "true");
    } else {
      for (const node of nodes) {
        const span = doc.createElement("span");
        span.setAttribute("contenteditable", "true");
        span.setAttribute("data-hle-editable", "true");
        span.setAttribute("data-hle-wrapper", "true");
        span.textContent = node.nodeValue;
        parent.replaceChild(span, node);
      }
    }
  }
}

/**
 * Serializa el documento del iframe al HTML que se enviará al backend:
 *   1. Desenvuelve los `<span data-hle-wrapper>` que creamos (vuelve al text node).
 *   2. Quita los attrs `contenteditable` y `data-hle-editable` que añadimos.
 *   3. Quita atributos `style`/`class` vacíos que algunos browsers añaden.
 *   4. Normaliza los text nodes adyacentes en body.
 *   5. Quita el `<style data-hle-editor="true">` que inyectamos.
 *   6. Quita la clase `hle-preview` del body.
 *   7. Prepende el doctype del documento original si existe.
 */
function serializeForParent(doc: Document): string {
  const clonedHtml = doc.documentElement.cloneNode(true) as HTMLElement;
  const body = clonedHtml.querySelector("body");

  clonedHtml.querySelectorAll("[data-hle-wrapper]").forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  });

  clonedHtml.querySelectorAll("[data-hle-editable]").forEach((el) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-hle-editable");
  });

  clonedHtml.querySelectorAll("[style]").forEach((el) => {
    if (!el.getAttribute("style")?.trim()) el.removeAttribute("style");
  });
  clonedHtml.querySelectorAll("[class]").forEach((el) => {
    if (!el.getAttribute("class")?.trim()) el.removeAttribute("class");
  });

  if (body) body.normalize();

  clonedHtml.querySelectorAll('style[data-hle-editor="true"]').forEach((s) => s.remove());

  if (body) body.classList.remove("hle-preview");

  const serializer = new XMLSerializer();
  const doctype = doc.doctype;
  let doctypeStr = "<!DOCTYPE html>\n";
  if (doctype) {
    doctypeStr = serializer.serializeToString(doctype) + "\n";
  }
  return doctypeStr + serializer.serializeToString(clonedHtml);
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function HtmlLiveEditor({ initialHtml, bundleId, editable }: HtmlLiveEditorProps) {
  // Estado del editor — toda la "interfaz de usuario" del HTML Live vive acá.
  const [currentHtml, setCurrentHtml] = useState(initialHtml);
  const [filename, setFilename] = useState<string>(
    initialHtml.trim() ? "portada.html" : "— sin documento —",
  );
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [editableCount, setEditableCount] = useState(0);
  const [docReady, setDocReady] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const innerIframeRef = useRef<HTMLIFrameElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Cleanup del listener `input` del documento del iframe entre cargas.
  const cleanupRef = useRef<(() => void) | null>(null);

  // Save action — vive dentro del editor (ago 2026) para que el botón
  // "Guardar HTML live" pueda estar en el toolbar superior. El editor
  // gestiona su propio `currentHtml` interno, así que ya no necesitamos
  // sincronizar un hidden input con el padre (antes era via `onChange`).
  const [saveState, saveAction] = useActionState<CoverHtmlFormState, FormData>(
    (prev, fd) => saveCoverHtmlAction(bundleId, prev, fd),
    { status: "idle" },
  );
  // dirty = hay cambios sin guardar respecto a lo persistido.
  const dirty = currentHtml !== initialHtml;

  // Cuando el padre nos pasa un nuevo initialHtml (ej. tras un reset),
  // sincronizamos currentHtml — React re-monta el iframe via `srcdoc`.
  // Si ya coincide con currentHtml, no hacemos nada (evitamos loop).
  useEffect(() => {
    if (initialHtml !== currentHtml) {
      setCurrentHtml(initialHtml);
      if (initialHtml.trim()) {
        setFilename("portada.html");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml]);

  // Cleanup en unmount.
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  /**
   * Handler del iframe `onLoad`. Se dispara cada vez que React actualiza
   * `srcdoc`. Re-aplica el walker + listeners; limpia los previos.
   */
  const onInnerIframeLoad = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    const doc = innerIframeRef.current?.contentDocument;
    if (!doc) return;

    try {
      injectEditorStyles(doc);
      makeEditable(doc.body || doc.documentElement);
    } catch (e) {
      console.error("[html-live-editor] walker falló", e);
      return;
    }

    setEditableCount(doc.querySelectorAll("[data-hle-editable]").length);
    setDocReady(true);
    if (isPreviewMode && doc.body) doc.body.classList.add("hle-preview");

    // TEMP DEBUG (ago 2026): diagnosticar "save sin editar → portada rota".
    // Reporta el estado del iframe justo después del walker para ver si
    // los <img> apuntan a /api/uploads/... o data: y si hay algo raro en
    // la estructura DOM que cause "desconfigurada".
    try {
      const imgs = Array.from(doc.querySelectorAll("img"));
      const apiUploadsCount = imgs.filter((img) =>
        (img.getAttribute("src") ?? "").startsWith("/api/uploads/"),
      ).length;
      const dataUriCount = imgs.filter((img) =>
        (img.getAttribute("src") ?? "").startsWith("data:"),
      ).length;
      const editableEls = doc.querySelectorAll("[data-hle-editable]").length;
      const wrapperSpans = doc.querySelectorAll("[data-hle-wrapper]").length;
      console.log("[html-live-editor] TEMP DEBUG iframe loaded:", {
        bundleId,
        initialHtmlChars: initialHtml.length,
        currentHtmlChars: currentHtml.length,
        sameAsInitial: initialHtml === currentHtml,
        imgTotal: imgs.length,
        imgApiUploads: apiUploadsCount,
        imgDataUri: dataUriCount,
        editableEls,
        wrapperSpans,
      });
    } catch {
      // ignore
    }

    let changeTimer: ReturnType<typeof setTimeout> | null = null;
    const onEdit = () => {
      setEditableCount(doc.querySelectorAll("[data-hle-editable]").length);
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        const html = serializeForParent(doc);
        setCurrentHtml(html);
      }, 250);
    };
    doc.body.addEventListener("input", onEdit);

    cleanupRef.current = () => {
      doc.body.removeEventListener("input", onEdit);
      if (changeTimer) clearTimeout(changeTimer);
    };
  }, [isPreviewMode]);

  // ------------------------- Toolbar handlers -------------------------

  const onOpenFileClick = () => fileInputRef.current?.click();

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result;
      if (typeof src === "string") {
        setFilename(file.name);
        setCurrentHtml(src);
      }
    };
    reader.onerror = () => console.error("[html-live-editor] no se pudo leer el archivo");
    reader.readAsText(file);
    e.target.value = "";
  };

  const onPasteClick = () => {
    setPasteValue(currentHtml);
    setPasteOpen(true);
  };

  const onPasteApply = () => {
    if (!pasteValue.trim()) return;
    setFilename("pegado.html");
    setCurrentHtml(pasteValue);
    setPasteOpen(false);
  };

  const onPasteCancel = () => setPasteOpen(false);

  const onSampleClick = () => {
    setFilename("ejemplo-portada.html");
    setCurrentHtml(SAMPLE_COVER_HTML);
  };

  const onResetClick = () => {
    // Reset al HTML persistido original (lo que pasamos como initialHtml
    // al montar). Si está vacío, no hacemos nada — la acción está deshabilitada.
    if (initialHtml.trim()) {
      setFilename("portada.html");
      setCurrentHtml(initialHtml);
    }
  };

  const onPreviewToggle = (e: ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setIsPreviewMode(checked);
    const doc = innerIframeRef.current?.contentDocument;
    if (doc?.body) doc.body.classList.toggle("hle-preview", checked);
  };

  // ------------------------- Drag & drop -------------------------

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      window.alert("Arrastra un archivo .html");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result;
      if (typeof src === "string") {
        setFilename(file.name);
        setCurrentHtml(src);
      }
    };
    reader.readAsText(file);
  };

  // ------------------------- Render -------------------------

  const hasContent = currentHtml.trim().length > 0;
  const canReset = hasContent && currentHtml !== initialHtml;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.dot} />
          HTML Live Editor
        </div>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onOpenFileClick}
            title="Abrir archivo .html"
          >
            📁 Abrir
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onPasteClick}
            title="Pegar código HTML"
          >
            📋 Pegar
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onSampleClick}
            title="Cargar ejemplo"
          >
            ✨ Ejemplo
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onResetClick}
            disabled={!canReset}
            title="Recargar original"
          >
            ↺ Reset
          </button>
        </div>
        <div className={styles.spacer} />
        <label
          className={styles.toggle}
          title="Ocultar marcadores de edición para ver el resultado final"
        >
          <input type="checkbox" checked={isPreviewMode} onChange={onPreviewToggle} />
          Vista previa
        </label>
        <form action={saveAction} className={styles.saveForm}>
          <input type="hidden" name="html" value={currentHtml} />
          <SaveButton disabled={!editable || !dirty} />
          {saveState.status === "success" && (
            <span className={styles.saveStatus} title="Cambios persistidos">
              Guardado.
            </span>
          )}
          {saveState.status === "error" && saveState.error && (
            <span className={styles.saveError} title={saveState.error}>
              {saveState.error}
            </span>
          )}
        </form>
        <input
          ref={fileInputRef}
          type="file"
          accept=".html,.htm,text/html"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
      </header>

      <div className={styles.paneBar}>
        <span>Vista previa editable</span>
        <span className={styles.filename}>{filename}</span>
        <div className={styles.spacer} />
        <span className={styles.badge}>
          {editableCount} texto{editableCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div
        className={`${styles.editorArea} ${dragOver ? styles.dragOver : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {hasContent ? (
          <iframe
            ref={innerIframeRef}
            title="Editor de portada (HTML Live)"
            sandbox="allow-same-origin"
            srcDoc={currentHtml}
            onLoad={onInnerIframeLoad}
          />
        ) : (
          <div className={styles.empty}>
            <div className={styles.icon}>📄</div>
            <h2>Carga un HTML para empezar</h2>
            <p>
              Abre un archivo <code>.html</code>, pega el código fuente, o prueba con el ejemplo.
              Los textos se vuelven editables directamente sobre la página, manteniendo los estilos
              originales.
            </p>
            <div className={styles.emptyActions}>
              <button type="button" className={styles.emptyBtn} onClick={onOpenFileClick}>
                📁 Abrir archivo
              </button>
              <button
                type="button"
                className={`${styles.emptyBtn} ${styles.emptyBtnGhost}`}
                onClick={onPasteClick}
              >
                📋 Pegar código
              </button>
              <button
                type="button"
                className={`${styles.emptyBtn} ${styles.emptyBtnGhost}`}
                onClick={onSampleClick}
              >
                ✨ Ver ejemplo
              </button>
            </div>
            <div className={styles.emptyHelp}>
              <strong>Cómo funciona</strong>
              1️⃣ Cargas el HTML
              <br />
              2️⃣ Haces clic en cualquier texto y editas — los estilos se respetan
              <br />
              3️⃣ Exportas a un nuevo <code>.html</code> con los cambios aplicados
            </div>
          </div>
        )}
      </div>

      <div className={styles.statusBar}>
        <span className={docReady ? styles.statusOk : undefined}>
          {hasContent
            ? docReady
              ? "Documento cargado · listo para editar"
              : "Cargando documento…"
            : "Listo · arrastra un .html aquí también"}
        </span>
        <div className={styles.spacer} />
        <span className={styles.sandboxStatus}>🔒 Sandbox activo</span>
      </div>

      {pasteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="paste-dialog-title"
          className={styles.dialogBackdrop}
        >
          <div className={styles.dialog}>
            <div className={styles.dialogHead}>
              <span id="paste-dialog-title">Pegar código HTML</span>
              <button type="button" className={styles.dialogClose} onClick={onPasteCancel}>
                ✕
              </button>
            </div>
            <div className={styles.dialogBody}>
              <textarea
                className={styles.dialogTextarea}
                value={pasteValue}
                onChange={(e) => setPasteValue(e.target.value)}
                placeholder="<!DOCTYPE html>&#10;<html>&#10;  <head>...</head>&#10;  <body>...</body>&#10;</html>"
                autoFocus
              />
              <div className={styles.dialogHint}>
                Pega el código completo, incluyendo <code>&lt;!DOCTYPE&gt;</code> si lo tienes. Se
                admiten fragmentos también.
              </div>
            </div>
            <div className={styles.dialogFoot}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={onPasteCancel}
              >
                Cancelar
              </button>
              <button type="button" className={styles.btn} onClick={onPasteApply}>
                Cargar HTML
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Botón submit del form de save. Usa `useFormStatus` para mostrar el
 * estado pendiente ("Guardando…") y respetar los estilos del toolbar
 * (`styles.btn` — indigo como el resto de CTAs del editor).
 */
function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.btn}
      disabled={disabled || pending}
      title="Persistir el HTML actual en el cuadernillo"
    >
      {pending ? "Guardando…" : "Guardar HTML live"}
    </button>
  );
}
