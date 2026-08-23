/**
 * Configuración de GrapesJS para el editor visual de portada.
 * =============================================================
 *
 * Este archivo define los 6 `studio-*` components (uno por `StudioBlockId`
 * del Cover Studio) + 4 genéricos (text/image/divider/two-column), y los
 * expone como bloques arrastrables en el Block Manager. El Style Manager
 * se restringe a propiedades seguras (no se permite position fixed/absolute,
 * z-index, transform: rotate/scale, ni background-image: url() a orígenes
 * no allowlisteados).
 *
 * ## Por qué browser-only
 *
 * GrapesJS manipula el DOM directamente — no funciona en Node. Por eso
 * `grapesjs-config.ts` se importa SOLO desde `grapesjs-editor.tsx`, que a
 * su vez se carga vía `dynamic({ ssr: false })` en `cover-visual-form.tsx`.
 * El servidor NUNCA importa este módulo.
 *
 * ## Convenciones
 *
 * - Cada `studio-*` component lleva `data-studio-block` apuntando al id
 *   estable (callout, howToMark, etc.). El helper `reInjectMarkers`
 *   normaliza esto al guardar.
 * - Los 6 studio components no se pueden borrar individualmente (lock);
 *   sí se pueden mover / duplicar / ocultar vía panel.
 * - Los genéricos se pueden borrar, mover, etc. sin restricción.
 *
 * ## Surface API cubierta
 *
 * Hoy solo configuramos `DomComponents` (componentes y modelos). El
 * Style Manager y el Block Manager usan las APIs nativas de GrapesJS.
 * Traits, Layers y Assets quedan en defaults (no tocamos).
 */

import grapesjs, { type Editor, type EditorConfig } from "grapesjs";
import { STUDIO_BLOCK_IDS, type StudioBlockId } from "@/modules/bundle-cover/domain/block-sections";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convierte un `StudioBlockId` a un `type` GrapesJS (`studio-callout`,
 *  `studio-how-to-mark`, etc.). */
function studioType(blockId: StudioBlockId): string {
  return `studio-${kebabToCamel(blockId)}`;
}

/** `itemsBefore` → `items-before` (kebab-case para GrapesJS types). */
function kebabToCamel(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/** Forma local de los 6 studio components. Tipamos nosotros para que la
 *  inferencia con `ComponentDefinition` no propague `unknown` cuando se
 *  hace spread al array de bloques del Block Manager. */
interface StudioComponentDef {
  type: string;
  label: string;
  category: string;
  attributes: Record<string, string>;
  removable: boolean;
  copyable: boolean;
  draggable: boolean;
  droppable: boolean;
  content: string;
}

/** Catálogo de definiciones de los 6 studio components. */
function studioComponentDefs(): StudioComponentDef[] {
  return STUDIO_BLOCK_IDS.map((blockId): StudioComponentDef => ({
    type: studioType(blockId),
    category: "Bloques del Cover Studio",
    label: BLOCK_LABELS[blockId],
    attributes: { "data-studio-block": blockId },
    removable: false,
    draggable: true,
    copyable: true,
    droppable: false,
    content: `<div data-studio-block="${blockId}" class="${BLOCK_DEFAULT_CLASS[blockId]}"></div>`,
  }));
}

/** Labels para el Block Manager (UI en español). El docente ve estos
 *  nombres al arrastrar. */
const BLOCK_LABELS: Record<StudioBlockId, string> = {
  callout: "Callout",
  howToMark: "Cómo marcar",
  itemsBefore: "Indicaciones previas",
  itemsAfter: "Indicaciones finales",
  prohibited: "Lo prohibido",
  legalFooter: "Pie legal",
};

/** Class CSS por defecto para cada studio block (espejo del built-in
 *  secundaria-v1.html). El walker server-side usa estos mismos nombres. */
const BLOCK_DEFAULT_CLASS: Record<StudioBlockId, string> = {
  callout: "callout",
  howToMark: "mark-row",
  itemsBefore: "items",
  itemsAfter: "items",
  prohibited: "prohibited-band",
  legalFooter: "legal-footer",
};

// ---------------------------------------------------------------------------
// Style Manager restringido
// ---------------------------------------------------------------------------

/**
 * Sectores permitidos en el Style Manager (lo que aparece en el panel
 * "Style" de GrapesJS). El docente puede ajustar estas propiedades; el
 * resto NO aparecen en la UI.
 *
 * Por seguridad:
 *   • No exponemos `position` (ni fixed/absolute/sticky).
 *   • No exponemos `z-index` (riesgo de superposición maliciosa).
 *   • No exponemos `transform: rotate/scale` (manipular el layout de la portada).
 *   • No exponemos `animation-*` (PDF no anima).
 *   • No exponemos `background-image: url(...)` salvo data:image/*.
 */
const STYLE_SECTORS: NonNullable<NonNullable<EditorConfig["styleManager"]>["sectors"]> = [
  {
    name: "Tipografía",
    properties: [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "letter-spacing",
      "text-align",
      "text-decoration",
      "text-transform",
      "color",
    ],
  },
  {
    name: "Fondo",
    properties: [
      "background-color",
      // No exponemos `background-image` directamente — el docente puede
      // subir imágenes vía el Asset Manager (que valida origen).
    ],
  },
  {
    name: "Espaciado",
    properties: [
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
    ],
  },
  {
    name: "Bordes",
    properties: [
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width",
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color",
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ],
  },
  {
    name: "Layout",
    properties: [
      "display",
      "width",
      "height",
      "max-width",
      "max-height",
      "min-width",
      "min-height",
      "flex-direction",
      "flex-wrap",
      "justify-content",
      "align-items",
      "gap",
      "grid-template-columns",
    ],
  },
  {
    name: "Decoración",
    properties: ["opacity", "box-shadow", "filter"],
  },
];

// ---------------------------------------------------------------------------
// Entry point: initEditor
// ---------------------------------------------------------------------------

/** Opciones del editor — separadas del bloque de init para que el caller
 *  (grapesjs-editor.tsx) controle altura, container y carga inicial. */
export interface InitEditorOptions {
  container: HTMLElement;
  /** Proyecto persistido (o vacío). Si es null, se inicializa con un
   *  canvas con los 6 studio blocks en orden. */
  initialProject?: unknown | null;
  /** Callback invocado cada vez que el proyecto cambia (autosave). */
  onChange?: (project: unknown) => void;
  /** Altura del canvas (CSS height). */
  height?: string;
}

/**
 * Inicializa el editor GrapesJS con la configuración del Cover Visual.
 * Devuelve la instancia del editor para que el caller pueda:
 *   • Suscribirse a eventos (`editor.on(...)`).
 *   • Llamar `editor.store()` para serializar el proyecto.
 *   • Llamar `editor.destroy()` al desmontar.
 */
export function initEditor(opts: InitEditorOptions): Editor {
  const editor = grapesjs.init({
    container: opts.container,
    height: opts.height ?? "800px",
    width: "auto",
    // Storage: en memoria. La persistencia la hace el server action.
    storageManager: { type: "none" },
    // Desactivamos el device manager (mobile/tablet/desktop) — la portada
    // es siempre tabloid (11×17"). El docente no necesita otros viewports.
    deviceManager: { devices: [] },
    // Canvas: la portada es un documento A4-like. Usamos un wrapper custom
    // width porque GrapesJS no tiene preset "tabloid".
    canvas: {
      styles: [
        // Resetear estilos del iframe para que la portada se vea limpia.
        "https://cdn.jsdelivr.net/npm/normalize.css@8/normalize.css",
      ],
      scripts: [],
    },
    // Panels por defecto.
    panels: { defaults: [] },
    // Componentes custom (6 studio + 4 genéricos).
    domComponents: {
      stylePrefix: "gjs-",
      components: [],
    },
    // Style Manager restringido.
    styleManager: { sectors: STYLE_SECTORS },
    // Bloques arrastrables — el docente arrastra desde aquí al canvas.
    blockManager: {
      appendTo: ".gjs-block-manager",
      blocks: [
        ...studioComponentDefs().map((def) => ({
          id: def.type,
          label: def.label,
          category: def.category,
          content: def.content,
          attributes: def.attributes,
        })),
        // 4 genéricos — GrapesJS ya trae `text` e `image` por defecto;
        // añadimos `divider` y `two-column` como custom.
        { id: "divider", label: "Separador", category: "Genéricos", content: "<hr/>" },
        {
          id: "two-column",
          label: "Dos columnas",
          category: "Genéricos",
          content:
            '<div data-gjs-type="two-column" style="display:flex; gap:16px;"><div style="flex:1"></div><div style="flex:1"></div></div>',
        },
      ],
    },
  });

  // Registrar los 6 studio types en DomComponents.
  for (const def of studioComponentDefs()) {
    editor.DomComponents.addType(def.type, {
      model: {
        defaults: {
          attributes: def.attributes,
          removable: def.removable,
          copyable: def.copyable,
          draggable: def.draggable,
          droppable: def.droppable,
        },
      },
    });
  }

  // Registrar `divider` y `two-column` como types (los genéricos `text` e
  // `image` ya vienen built-in en GrapesJS).
  editor.DomComponents.addType("divider", {
    model: { defaults: { tagName: "hr" } },
  });
  editor.DomComponents.addType("two-column", {
    model: {
      defaults: {
        tagName: "div",
        attributes: { "data-gjs-type": "two-column" },
        droppable: true,
        components: [
          { type: "text", tagName: "div", content: "", style: { flex: "1" } },
          { type: "text", tagName: "div", content: "", style: { flex: "1" } },
        ],
      },
    },
  });

  // Cargar proyecto persistido si existe, si no inicializar con los 6
  // studio blocks en orden vertical.
  if (opts.initialProject) {
    try {
      editor.loadProjectData(opts.initialProject as Parameters<typeof editor.loadProjectData>[0]);
    } catch (err) {
      // Si el JSON persistido está corrupto, arrancamos con canvas vacío.
      // (El server action igual rechazará el save con Zod error.)
      console.warn("[grapesjs-config] No se pudo cargar initialProject:", err);
    }
  } else {
    seedDefaultProject(editor);
  }

  // Suscribirse a cambios para notificar al caller (autosave).
  if (opts.onChange) {
    const emit = () => opts.onChange!(editor.getProjectData());
    editor.on("component:update", emit);
    editor.on("component:add", emit);
    editor.on("component:remove", emit);
    editor.on("style:update", emit);
  }

  return editor;
}

/** Crea un proyecto inicial con los 6 studio blocks en orden vertical
 *  (igual al built-in secundaria-v1). El docente puede reordenarlos
 *  después. */
function seedDefaultProject(editor: Editor): void {
  const wrapper = editor.DomComponents.getWrapper();
  if (!wrapper) return;
  wrapper.components().reset([
    { type: studioType("callout"), content: BLOCK_DEFAULT_CLASS.callout },
    { type: studioType("howToMark"), content: BLOCK_DEFAULT_CLASS.howToMark },
    { type: studioType("itemsBefore"), content: BLOCK_DEFAULT_CLASS.itemsBefore },
    { type: studioType("itemsAfter"), content: BLOCK_DEFAULT_CLASS.itemsAfter },
    { type: studioType("prohibited"), content: BLOCK_DEFAULT_CLASS.prohibited },
    { type: studioType("legalFooter"), content: BLOCK_DEFAULT_CLASS.legalFooter },
  ]);
}

/** Re-export para callers que necesiten el mapping type→blockId. */
export { studioType, BLOCK_LABELS, BLOCK_DEFAULT_CLASS };
