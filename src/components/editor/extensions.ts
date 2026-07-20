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

/**
 * Puentea el ancho de columna al HTML que se imprime.
 *
 * `prosemirror-tables` guarda el ancho en `colwidth` (un array, por si la
 * celda abarca varias columnas) y en el navegador lo aplica pintando
 * `<col style="width:Npx">` en el colgroup. Pero `generateHTML` en el
 * servidor emite el colgroup VACÍO y deja un `colwidth="220"` en la celda,
 * que no es un atributo HTML real: el navegador lo ignora y la tabla saldría
 * impresa con las columnas por defecto.
 *
 * Se añade además el atributo legado `width`, que sí respetan los navegadores
 * (mismo mecanismo que se usó para el ancho de imagen). No se usa `style`
 * porque el DOM del servidor lo descarta al sanitizar.
 */
function withPrintableWidth<T extends { extend: (config: object) => T }>(cellExtension: T): T {
  return cellExtension.extend({
    addAttributes(this: { parent?: () => Record<string, unknown> }) {
      return {
        ...this.parent?.(),
        colwidth: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const raw = element.getAttribute("colwidth") ?? element.getAttribute("width");
            if (!raw) return null;
            const parsed = raw
              .replace("px", "")
              .split(",")
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n) && n > 0);
            return parsed.length > 0 ? parsed : null;
          },
          renderHTML: (attributes: Record<string, unknown>) => {
            const colwidth = attributes.colwidth as number[] | null;
            if (!colwidth || colwidth.length === 0) return {};
            // Con celdas combinadas, `colwidth` trae un ancho por columna
            // abarcada; el ancho de la celda es la suma.
            const total = colwidth.reduce((a, b) => a + b, 0);
            return { colwidth: colwidth.join(","), width: String(total) };
          },
        },
      };
    },
  });
}

export const PrintableTableCell = withPrintableWidth(TableCell);
export const PrintableTableHeader = withPrintableWidth(TableHeader);

/**
 * Fila con alto ajustable. `prosemirror-tables` NO trae alto de fila (su
 * `resizable` solo redimensiona columnas), así que el atributo es propio.
 *
 * Igual que el ancho: atributo HTML legado `height`, no `style`.
 */
export const ResizableTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null as number | null,
        parseHTML: (element) => {
          const raw = element.getAttribute("data-height") ?? element.getAttribute("height");
          const n = raw ? Number(String(raw).replace("px", "")) : NaN;
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attributes) => {
          const height = attributes.height as number | null;
          if (!height) return {};
          return { "data-height": String(height), height: String(height) };
        },
      },
    };
  },
});

export const richTextExtensions: Extensions = [
  StarterKit,
  TextAlign,
  ResizableImage,
  // `resizable: true` activa los tiradores de columna de prosemirror-tables.
  Table.configure({ resizable: true }),
  ResizableTableRow,
  PrintableTableHeader,
  PrintableTableCell,
];

/** Documento TipTap vacío (valor inicial de un editor sin contenido). */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
