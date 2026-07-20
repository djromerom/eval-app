"use client";

import { useCallback, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { EMPTY_DOC, richTextExtensions } from "./extensions";

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

function Toolbar({ editor, onPickImage }: { editor: Editor; onPickImage: () => void }) {
  return (
    <div className="bg-muted/40 flex flex-wrap items-center gap-0.5 border-b p-1">
      <ToolbarButton
        title="Negrita"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </ToolbarButton>
      <ToolbarButton
        title="Itálica"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </ToolbarButton>
      <ToolbarButton
        title="Título"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H
      </ToolbarButton>
      <ToolbarButton
        title="Lista con viñetas"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </ToolbarButton>
      <ToolbarButton
        title="Lista numerada"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </ToolbarButton>
      <ToolbarButton
        title="Cita"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </ToolbarButton>
      <ToolbarButton
        title="Insertar tabla 3×2"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run()
        }
      >
        ▦
      </ToolbarButton>
      <ToolbarButton title="Insertar imagen (o pégala / arrástrala)" onClick={onPickImage}>
        🖼
      </ToolbarButton>
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
  onChange,
}: {
  name: string;
  defaultValue?: unknown;
  minHeightClass?: string;
  /**
   * Callback opcional con el JSON parseado en cada edición. Útil cuando el
   * padre necesita el documento (por ejemplo para reflejarlo en una preview
   * en vivo). Si no se pasa, el editor funciona igual — solo emite el hidden
   * input y no notifica al padre.
   */
  onChange?: (json: Record<string, unknown>) => void;
}) {
  const [json, setJson] = useState(() => JSON.stringify(initialContent(defaultValue)));
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
    extensions: richTextExtensions,
    content: initialContent(defaultValue),
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
    },
  });
  editorRef.current = editor;

  return (
    <div className="border-input bg-background rounded-md border shadow-sm">
      {editor ? (
        <Toolbar editor={editor} onPickImage={() => fileInputRef.current?.click()} />
      ) : null}
      <EditorContent editor={editor} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
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
