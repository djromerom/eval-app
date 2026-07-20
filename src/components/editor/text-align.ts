import { Extension } from "@tiptap/core";

export const ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

/** Tipos de nodo que aceptan alineación. */
const ALIGNABLE_TYPES = ["paragraph", "heading", "image"];

/** Clase CSS que corresponde a cada alineación (definidas en globals.css). */
export function alignClass(align: Alignment): string {
  return `ta-${align}`;
}

export function isAlignment(value: unknown): value is Alignment {
  return typeof value === "string" && (ALIGNMENTS as readonly string[]).includes(value);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textAlign: {
      setAlign: (align: Alignment) => ReturnType;
      unsetAlign: () => ReturnType;
    };
  }
}

/**
 * Alineación de párrafos, títulos e imágenes.
 *
 * Se emite como CLASE (`ta-center`) y no como `style="text-align:…"`, que es
 * lo que hace `@tiptap/extension-text-align`. Motivo: el DOM que usa
 * `generateHTML` en el servidor descarta `style` al sanitizar, así que la
 * alineación se vería en el editor y desaparecería en el PDF — el mismo
 * fallo silencioso que tuvo el ancho de imagen. Las clases sí sobreviven.
 *
 * Escrito a mano en vez de instalar la extensión oficial porque cambiarle el
 * `renderHTML` obliga a redeclarar `addGlobalAttributes` entera, que es
 * prácticamente todo lo que aporta.
 */
export const TextAlign = Extension.create({
  name: "textAlign",

  addGlobalAttributes() {
    return [
      {
        types: ALIGNABLE_TYPES,
        attributes: {
          align: {
            default: null as Alignment | null,
            parseHTML: (element) => {
              const found = ALIGNMENTS.find((a) => element.classList.contains(alignClass(a)));
              return found ?? null;
            },
            renderHTML: (attributes) => {
              const align = attributes.align;
              // Solo se emiten las alineaciones conocidas: el JSON viene de la
              // BD y podría estar manipulado, y no queremos que un valor
              // arbitrario acabe convertido en una clase del documento.
              if (!isAlignment(align) || align === "left") return {};
              return { class: alignClass(align) };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setAlign:
        (align: Alignment) =>
        ({ commands }) =>
          // Se aplica a todos los tipos alineables: el usuario puede tener el
          // cursor en un párrafo o una imagen seleccionada, y el comando debe
          // funcionar en ambos casos.
          ALIGNABLE_TYPES.some((type) => commands.updateAttributes(type, { align })),
      unsetAlign:
        () =>
        ({ commands }) =>
          ALIGNABLE_TYPES.some((type) => commands.resetAttributes(type, "align")),
    };
  },
});
