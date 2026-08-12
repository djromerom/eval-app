"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { EditorContent, ReactNodeViewRenderer, useEditor, type Editor } from "@tiptap/react";
import { EMPTY_DOC, ResizableImage, richTextExtensions } from "./extensions";
import type { Alignment } from "./text-align";
import { ResizableImageView } from "./resizable-image-view";
import { TableControls, TableInsertButton } from "./table-toolbar";
import { cn } from "@/lib/utils";

/**
 * Extensiones del editor = las compartidas, pero con la imagen envuelta en su
 * NodeView de React (tiradores para redimensionar).
 *
 * El NodeView solo afecta a la edición: el esquema y los atributos son los
 * mismos que usa `generateHTML` en el servidor, así que el JSON viaja igual.
 * Vive aquí y no en extensions.ts porque ese módulo debe seguir siendo
 * agnóstico del framework (lo importa el renderer del servidor).
 */
const editorExtensions = richTextExtensions.map((ext) =>
  ext.name === ResizableImage.name
    ? ResizableImage.extend({
        addNodeView: () => ReactNodeViewRenderer(ResizableImageView),
      })
    : ext,
);

/**
 * Sube una imagen y devuelve su URL servida por `/api/uploads/`.
 * Lanza con el mensaje del servidor para que el editor pueda mostrarlo.
 */
async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? "No se pudo subir la imagen.");
  }
  return data.url;
}

/** Imágenes de un DataTransfer (portapapeles o arrastre). */
function imagesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

function initialContent(defaultValue: unknown): object {
  if (typeof defaultValue === "string") {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: defaultValue ? [{ type: "text", text: defaultValue }] : [],
        },
      ],
    };
  }
  if (defaultValue && typeof defaultValue === "object") return defaultValue as object;
  return EMPTY_DOC as unknown as object;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-7 min-w-7 rounded px-1.5 text-sm ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

/** Iconos de alineación dibujados con líneas, para no depender de una fuente. */
function AlignIcon({ align }: { align: Alignment }) {
  // Anchos de las 4 líneas según la alineación; `justify` las pone todas
  // completas, que es justo lo que significa.
  const rows =
    align === "justify" ? [10, 10, 10, 10] : align === "center" ? [10, 6, 10, 6] : [10, 6, 10, 6];
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const x = anchor === "middle" ? 6 : anchor === "end" ? 11 : 1;
  return (
    <svg viewBox="0 0 12 10" className="h-3 w-3" aria-hidden>
      {rows.map((w, i) => (
        <rect
          key={i}
          x={anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x}
          y={i * 2.6}
          width={w}
          height="1.2"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

const ALIGN_BUTTONS: { align: Alignment; title: string; icon: React.ReactNode }[] = [
  { align: "left", title: "Alinear a la izquierda", icon: <AlignIcon align="left" /> },
  { align: "center", title: "Centrar", icon: <AlignIcon align="center" /> },
  { align: "right", title: "Alinear a la derecha", icon: <AlignIcon align="right" /> },
  { align: "justify", title: "Justificar", icon: <AlignIcon align="justify" /> },
];

function Toolbar({
  editor,
  onPickImage,
  variant = "default",
}: {
  editor: Editor;
  onPickImage: () => void;
  variant?: "default" | "option";
}) {
  // Variante "option" (ago 2026): toolbar mínima para las opciones de
  // respuesta del QuestionForm. Bold, Math inline, Math bloque, Imagen
  // y Tabla. SIN headings, listas, blockquote, alineación — el docente
  // no compone un ensayo en una opción, solo incrusta una fórmula o
  // una imagen al lado del texto. La altura también se reduce (el
  // padre pasa una minHeightClass menor).
  const isOption = variant === "option";

  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-0.5 border-b p-1">
      <ToolbarButton
        title="Negrita"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </ToolbarButton>
      {!isOption ? (
        <ToolbarButton
          title="Itálica"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </ToolbarButton>
      ) : null}
      {!isOption ? (
        <ToolbarButton
          title="Título"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H
        </ToolbarButton>
      ) : null}
      {!isOption ? (
        <ToolbarButton
          title="Lista con viñetas"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
      ) : null}
      {!isOption ? (
        <ToolbarButton
          title="Lista numerada"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
      ) : null}
      {!isOption ? (
        <ToolbarButton
          title="Cita"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          ❝
        </ToolbarButton>
      ) : null}
      <TableInsertButton editor={editor} />
      <ToolbarButton title="Insertar imagen (o pégala / arrástrala)" onClick={onPickImage}>
        <ImageIcon className="h-4 w-4" aria-hidden />
      </ToolbarButton>

      {!isOption ? (
        <>
          <span className="bg-border mx-1 h-5 w-px" aria-hidden />

          {/* Alinea el párrafo donde está el cursor, o la imagen seleccionada. */}
          {ALIGN_BUTTONS.map(({ align, title, icon }) => (
            <ToolbarButton
              key={align}
              title={title}
              // `left` es el valor por defecto y no se guarda: se marca activo
              // también cuando no hay alineación puesta.
              active={
                editor.isActive({ align }) ||
                (align === "justify" && !editor.getAttributes("paragraph").align)
              }
              onClick={() => editor.chain().focus().setAlign(align).run()}
            >
              {icon}
            </ToolbarButton>
          ))}
        </>
      ) : null}
      <span className="text-muted-foreground ml-1 text-xs">
        Fórmulas: escribe <code>$x^2$</code> o <code>$$…$$</code>
      </span>
    </div>
  );
}

/**
 * Editor de texto enriquecido (TipTap). Sincroniza su documento JSON a un input
 * oculto `name`, así los formularios lo envían como string JSON. Las fórmulas se
 * escriben como `$...$` y se renderizan con KaTeX al mostrar/imprimir.
 */
export function RichTextEditor({
  name,
  defaultValue,
  minHeightClass = "min-h-24",
  disabled = false,
  variant = "default",
  onChange,
  autoFocus = false,
  focusHighlight = false,
  error = false,
}: {
  name: string;
  defaultValue?: unknown;
  minHeightClass?: string;
  /**
   * Si `true`, el editor pasa a modo lectura: no responde a teclado, no
   * permite pegar imágenes desde portapapeles, oculta Toolbar y controles
   * de tabla. Se sigue emitiendo el `<input type="hidden">` con el JSON
   * para que el form nativo mantenga el valor. Mapea directo a la opción
   * `editable: !disabled` de TipTap (ago 2026).
   */
  disabled?: boolean;
  /**
   * Variante visual del editor (ago 2026).
   *  - "default": toolbar completa (negrita, itálica, headings, listas,
   *    cita, tabla, imagen, alineación). Usado por el enunciado y el
   *    bloque Contexto.
   *  - "option": toolbar mínima (negrita, tabla, imagen) pensada para
   *    las opciones de respuesta del QuestionForm. El docente que
   *    escribe "x²+1" en plano no quiere ver 11 botones; el que
   *    necesita incrustar una fórmula/imagen lo hace con 3 botones.
   *    Mismo schema JSON que "default" — solo cambia el chrome.
   */
  variant?: "default" | "option";
  /**
   * Callback opcional con el JSON parseado en cada edición. Útil cuando el
   * padre necesita el documento (por ejemplo para reflejarlo en una preview
   * en vivo). Si no se pasa, el editor funciona igual — solo emite el hidden
   * input y no notifica al padre.
   */
  onChange?: (json: Record<string, unknown>) => void;
  /**
   * Si `true`, el editor se enfoca automáticamente al (re)montar.
   * Pensado para el flujo "guardar y seguir" del QuestionForm: tras
   * un guardado exitoso el form resetea + remonta el TipTap del
   * enunciado vía `key={resetKey}`; el padre pasa `autoFocus=true`
   * en ese nuevo mount y el cursor aterriza en el enunciado listo
   * para tipear la siguiente pregunta. Se consume una vez por
   * instancia (no refocus en re-renders del mismo mount). (ago 2026)
   */
  autoFocus?: boolean;
  /**
   * Si `true`, ilumina el borde con el azul marca (color primario
   * ecognIA, `#0A4FA8`) + ring suave cuando el editor recibe foco.
   * El highlight se mantiene mientras el editor esté enfocado — se
   * apaga solo en `onBlur`. Antes se desvanecía en el primer `onUpdate`
   * ("feedback solo para confirmar 'el cursor aterrizó aquí'"), pero
   * el docente pidió (ago 2026) que se mantenga mientras se tipea:
   * "cuando este editando deja el borde azul oscuro no lo quites
   * mientras edito en un tip tap". Default `false` para no afectar las
   * opciones expandidas ni el bloque Contexto; el enunciado del
   * QuestionForm lo activa explícitamente.
   */
  focusHighlight?: boolean;
  /**
   * Si `true`, pinta el borde con el color destructivo (rojo) + ring
   * persistente (no depende de foco). Lo usa el editor unificado para
   * señalar campos del bloque Contexto que fallaron validación:
   * cuando el docente pulsa "Guardar" sin título y/o descripción, el
   * borde se queda rojo hasta que empiece a tipear. Default `false`
   * para no afectar las opciones expandidas ni el enunciado. (ago 2026,
   * pedido del docente: "vamos a colorear el borde de rojo de los que
   * no se hayan llenado").
   */
  error?: boolean;
}) {
  const [json, setJson] = useState(() => JSON.stringify(initialContent(defaultValue)));
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Highlight de foco (opt-in vía `focusHighlight`). true entre onFocus
  // y el primer onUpdate; false en onBlur. (ago 2026)
  const [isFocusHighlighted, setIsFocusHighlighted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // El editor se necesita dentro de los handlers, que se definen antes de que
  // `useEditor` retorne; la ref rompe esa dependencia circular.
  const editorRef = useRef<Editor | null>(null);

  /**
   * Sube las imágenes y las inserta donde está el cursor. Varias a la vez se
   * procesan en serie para que entren en el orden en que se soltaron.
   */
  const insertImages = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploadError(null);
    setUploading((n) => n + files.length);
    try {
      for (const file of files) {
        try {
          const url = await uploadImage(file);
          editorRef.current?.chain().focus().setImage({ src: url }).run();
        } catch (e) {
          setUploadError(e instanceof Error ? e.message : "No se pudo subir la imagen.");
        } finally {
          setUploading((n) => n - 1);
        }
      }
    } catch {
      setUploading(0);
    }
  }, []);

  const editor = useEditor({
    extensions: editorExtensions,
    content: initialContent(defaultValue),
    // `editable: !disabled` controla toda la interactividad del editor —
    // teclado, pegar, arrastrar, comandos. Cuando es `false`, TipTap
    // ignora cualquier intento de mutación del documento. (ago 2026)
    //
    // OJO: esta opción SOLO se lee al construir el editor. Cambiar la prop
    // `disabled` después del mount NO reconfigura el editor por sí sola —
    // necesitamos reflejarlo con `editor.setEditable(!disabled)` en el
    // effect de abajo (caso de uso: el docente pulsa "Editar contexto"
    // en el editor unificado, lo cual cambia editingContext de false a
    // true y por tanto `disabled` de true a false).
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `prose-eval ${minHeightClass} w-full px-3 py-2 focus:outline-none`,
      },
      /**
       * Pegar una captura de pantalla es el caso más frecuente: el docente
       * recorta un diagrama y hace Ctrl+V. Devolver `true` cancela el pegado
       * por defecto (que insertaría un `data:` URI gigante en el documento).
       */
      handlePaste: (_view, event) => {
        const files = imagesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imagesFrom((event as DragEvent).dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(files);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.getJSON() as Record<string, unknown>;
      setJson(JSON.stringify(next));
      onChange?.(next);
      // NO apagamos el highlight de foco en onUpdate. Antes sí
      // (feedback solo para confirmar "el cursor aterrizó acá"), pero
      // el docente pidió (ago 2026) que se mantenga mientras se tipea.
      // El highlight solo se apaga en onBlur, más abajo. Si en el
      // futuro hay que distinguir entre "focus sin tipear" y
      // "focus + tipeando", este es el lugar para reintroducir la
      // distinción.
    },
    onFocus: () => {
      // onFocus también se dispara en el autoFocus programático (el
      // editor.commands.focus() interno de TipTap emite el evento), así
      // que el highlight se enciende también en el flujo "guardar y
      // seguir". (ago 2026)
      setIsFocusHighlighted(true);
    },
    onBlur: () => {
      // Blur siempre apaga, incluso si el usuario nunca llegó a escribir
      // (ej. tab-in, tab-out sin tipear). El highlight solo vive entre
      // focus y el primer cambio del documento. (ago 2026)
      setIsFocusHighlighted(false);
    },
  });
  editorRef.current = editor;

  // Refleja cambios reactivos de `disabled` en el editor. TipTap solo lee
  // `editable` en el constructor; cuando el padre cambia la prop (caso
  // típico: el docente pulsa "Editar contexto" en el bloque Contexto del
  // editor unificado, encendiendo `editingContext` y por tanto bajando
  // `disabled` de true a false), tenemos que llamar `setEditable` para
  // que el editor deje de ignorar teclado/pegado/arrastre. Sin este
  // effect, los inputs del formulario se desbloquean pero TipTap sigue
  // mudo. (ago 2026)
  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Auto-focus al (re)montar cuando el padre lo pide. Se consume una vez
  // por instancia: el flag `hasFocusedRef` evita refocus en re-renders
  // del mismo mount, y como `key` fuerza remount entre guardados del
  // QuestionForm, cada nuevo instance arranca fresco y enfoca. (ago 2026)
  const hasFocusedRef = useRef(false);
  useEffect(() => {
    if (autoFocus && editor && !hasFocusedRef.current) {
      hasFocusedRef.current = true;
      // Un tick para que el EditorContent ya esté pintado y el cursor
      // aterrice en el `<p>` inicial del doc vacío (TipTap enfoca el
      // contenteditable, posición por defecto = inicio).
      requestAnimationFrame(() => {
        editor.commands.focus();
      });
    }
  }, [editor, autoFocus]);

  return (
    <div
      className={cn(
        "border-input bg-background rounded-md border shadow-sm transition-colors",
        // Highlight de foco (opt-in): solo se enciende cuando el padre
        // pasa `focusHighlight` y el editor está en el intervalo entre
        // onFocus y el primer onUpdate. Se desvanece al tipear. (ago 2026)
        focusHighlight && isFocusHighlighted && "border-primary ring-primary/30 ring-2",
        // Error de validación (opt-in): cuando el padre pasa `error=true`,
        // pintamos el borde rojo persistente (sin depender de foco). Lo usa
        // el editor unificado para resaltar el campo Contexto cuando la
        // validación falla (ago 2026, pedido del docente: "vamos a colorear
        // el borde de rojo de los que no se hayan llenado").
        error && "border-destructive ring-destructive/30 ring-2",
      )}
    >
      {editor && !disabled ? (
        <>
          <Toolbar
            editor={editor}
            onPickImage={() => fileInputRef.current?.click()}
            variant={variant}
          />
          {/* Segunda fila contextual: solo aparece con el cursor en una tabla. */}
          <TableControls editor={editor} />
        </>
      ) : null}
      <EditorContent editor={editor} className={disabled ? "cursor-default" : undefined} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          void insertImages(Array.from(e.target.files ?? []));
          // Permite volver a elegir el mismo archivo si hizo falta reintentar.
          e.target.value = "";
        }}
      />
      {uploading > 0 ? (
        <p className="text-muted-foreground border-t px-3 py-1 text-xs">
          Subiendo {uploading} imagen(es)…
        </p>
      ) : null}
      {uploadError ? (
        <p className="text-destructive border-t px-3 py-1 text-xs" role="alert">
          {uploadError}
        </p>
      ) : null}
      <input type="hidden" name={name} value={json} />
    </div>
  );
}
