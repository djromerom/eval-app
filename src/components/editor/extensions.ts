import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";
import { Node, type Extensions } from "@tiptap/core";
import katex from "katex";
import { TextAlign } from "./text-align";

/**
 * Extensiones de TipTap compartidas por el editor (cliente) y el renderer
 * server-side (`generateHTML`). Marco agnóstico: NO importar @tiptap/react aquí.
 *
 * Las fórmulas KaTeX se manejan como NODOS (`inlineMath` / `blockMath`) desde
 * el PR que añadió el import LaTeX-aware. Previamente vivían como `$...$`
 * literales en el doc, lo que impedía editarlas/copiarlas; ahora son átomos
 * con su `tex` en un atributo. La red de seguridad para preguntas LEGACY
 * con `$...$` como texto sigue siendo `applyKatex` en `render.ts`.
 */

/**
 * Renderiza un fragmento LaTeX con KaTeX a HTML. Server-safe
 * (`katex.renderToString` no toca el DOM). Si la fórmula es sintácticamente
 * inválida, degrada al literal escapado con sus delimitadores — así nunca
 * lanzamos un 500 en una pregunta mal importada: la profesora ve `$x<$` o
 * `$$x<y$$` y puede corregirla desde el editor.
 */
function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    const d = displayMode ? "$$" : "$";
    const safe = tex.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `${d}${safe}${d}`;
  }
}

function safeTex(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * Fórmula en línea (`$x^2$`). Atómica: el cursor entra al nodo como una unidad
 * y no se puede editar el `tex` carácter por carácter — coherente con el
 * modelo "se edita LaTeX, no se renderiza carácter a carácter".
 *
 * El HTML emitido en `renderHTML` envuelve el resultado de KaTeX en un
 * `<span class="math-inline" data-tex="…">` para que (a) el editor visual lo
 * muestre como un bloque (TipTap usa el HTML como NodeView por defecto),
 * (b) el CSS global pueda afinar tamaño/espaciado, y (c) el backfill futuro
 * pueda re-extraer el `tex` desde el DOM si hace falta migrar preguntas
 * pre-PR.
 */
export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      tex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-tex") ?? "",
        renderHTML: (attributes) => ({ "data-tex": safeTex(attributes.tex) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span.math-inline" }];
  },
  renderHTML({ node }) {
    const tex = safeTex(node.attrs.tex);
    return ["span", { class: "math-inline", "data-tex": tex }, renderKatex(tex, false)];
  },
});

/**
 * Fórmula en bloque (`$$x^2 + y^2 = z^2$$`). Nodo top-level (no puede ir
 * dentro de un `paragraph`) — los parsers deben emitirlo al mismo nivel que
 * los párrafos. Misma política de fallback que `InlineMath`.
 */
export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      tex: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-tex") ?? "",
        renderHTML: (attributes) => ({ "data-tex": safeTex(attributes.tex) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div.math-block" }];
  },
  renderHTML({ node }) {
    const tex = safeTex(node.attrs.tex);
    return ["div", { class: "math-block", "data-tex": tex }, renderKatex(tex, true)];
  },
});
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
  // Nodos para fórmulas LaTeX. Los detecta el import (`latex-to-tiptap.ts`)
  // al construir el doc y los persiste como átomos; en render
  // (`generateHTML` server-side / NodeView por defecto en cliente) emiten
  // KaTeX renderizado. La detección de texto crudo `$...$` que ya existía en
  // `render.ts: applyKatex` se conserva como red de seguridad para datos
  // importados antes de este cambio.
  InlineMath,
  BlockMath,
];

/** Documento TipTap vacío (valor inicial de un editor sin contenido). */
export const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] } as const;
