import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";

/**
 * Extensiones de TipTap compartidas por el editor (cliente) y el renderer
 * server-side (`generateHTML`). Marco agnóstico: NO importar @tiptap/react aquí.
 * Las fórmulas KaTeX se manejan como texto `$...$` y se renderizan al mostrar
 * (ver components/editor/render.ts), no como nodo, para funcionar en servidor.
 */
export const richTextExtensions: Extensions = [
  StarterKit,
  Image,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

/** Documento TipTap vacío (valor inicial de un editor sin contenido). */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
