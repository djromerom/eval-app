import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";
import { TextAlign } from "./text-align";

/**
 * Extensiones de TipTap compartidas por el editor (cliente) y el renderer
 * server-side (`generateHTML`). Marco agnóstico: NO importar @tiptap/react aquí.
 * Las fórmulas KaTeX se manejan como texto `$...$` y se renderizan al mostrar
 * (ver components/editor/render.ts), no como nodo, para funcionar en servidor.
 */
/**
 * Imagen con ancho ajustable, guardado como PORCENTAJE del ancho disponible.
 *
 * En píxeles no serviría: el editor mide ~900 px y la columna impresa de una
 * carta ronda los 17 cm, así que un ancho fijo se vería de un tamaño en
 * pantalla y de otro en el papel. El porcentaje se traduce igual en ambos.
 *
 * Se emite como atributo HTML `width="N%"`, NO como `style`: el DOM que usa
 * `generateHTML` en el servidor descarta `style` al sanitizar, así que un
 * ancho puesto por ahí no llegaría nunca al PDF. El atributo `width` con
 * porcentaje es la forma legada que los navegadores mapean a la propiedad
 * CSS, y sobrevive intacto. (Poner `STYLE` en mayúsculas también pasa el
 * filtro, pero evadir el sanitizador para esto no compensa.)
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null as number | null,
        parseHTML: (element) => {
          // `data-width` es la fuente al releer; `width` puede traer "60%".
          const raw =
            element.getAttribute("data-width") ?? element.getAttribute("width")?.replace("%", "");
          const n = raw ? Number(raw) : NaN;
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attributes) => {
          const width = attributes.width as number | null;
          if (!width) return {};
          return { "data-width": String(width), width: `${width}%` };
        },
      },
    };
  },
});

export const richTextExtensions: Extensions = [
  StarterKit,
  TextAlign,
  ResizableImage,
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];

/** Documento TipTap vacío (valor inicial de un editor sin contenido). */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
