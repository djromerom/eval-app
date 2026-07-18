"use client";

import { useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { EMPTY_DOC, richTextExtensions } from "./extensions";

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

function Toolbar({ editor }: { editor: Editor }) {
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
      <ToolbarButton
        title="Insertar imagen por URL"
        onClick={() => {
          const url = window.prompt("URL de la imagen");
          if (url) editor.chain().focus().setImage({ src: url }).run();
        }}
      >
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

  const editor = useEditor({
    extensions: richTextExtensions,
    content: initialContent(defaultValue),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `prose-eval ${minHeightClass} w-full px-3 py-2 focus:outline-none`,
      },
    },
    onUpdate: ({ editor }) => {
      const next = editor.getJSON() as Record<string, unknown>;
      setJson(JSON.stringify(next));
      onChange?.(next);
    },
  });

  return (
    <div className="border-input bg-background rounded-md border shadow-sm">
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={json} />
    </div>
  );
}
