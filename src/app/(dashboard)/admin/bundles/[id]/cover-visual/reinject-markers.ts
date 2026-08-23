/**
 * Helper cliente: re-inject de markers en el proyecto GrapesJS.
 * ==============================================================
 *
 * Cuando el docente guarda el proyecto, este helper ANOTA cada componente
 * studio-* con el atributo `data-studio-block="ID"` correspondiente al
 * block id (callout, howToMark, etc.). Esto cumple dos funciones:
 *
 *   1. Auto-documentación — el JSON guardado lleva el id embebido, así
 *      que un consumidor externo (ej. un script de auditoría) puede
 *      saber qué bloque es cada componente sin mapear type→id.
 *
 *   2. Defensa-en-profundidad — si el walker server-side (en
 *      `domain/grapesjs-renderer.ts`) por alguna razón no reconoce el
 *      type (versión desactualizada, bug), el atributo `data-studio-block`
 *      sigue presente en el JSON y un walker alternativo podría
 *      identificar el bloque por él.
 *
 * NOTA: el walker server-side YA sabe mapear type→id via
 * `COMPONENT_TO_ENVELOPE`. Este helper es **redundante** para el render
 * server (no cambia el output), pero mantiene el JSON más legible y
 * permite tests sin tocar GrapesJS.
 *
 * Idempotente: si el atributo ya existe, no lo duplica. Si tiene el valor
 * incorrecto, lo corrige.
 */
import { isStudioBlockId, type StudioBlockId } from "@/modules/bundle-cover/domain/block-sections";

/** Mapeo `type` (GrapesJS) → `blockId` (Cover Studio). Espejo del
 *  `COMPONENT_TO_ENVELOPE` del walker server-side, sin la info de envelope. */
export const STUDIO_TYPE_TO_BLOCK_ID: Readonly<Record<string, StudioBlockId>> = {
  "studio-callout": "callout",
  "studio-how-to-mark": "howToMark",
  "studio-items-before": "itemsBefore",
  "studio-items-after": "itemsAfter",
  "studio-prohibited": "prohibited",
  "studio-legal-footer": "legalFooter",
};

/** Componente GrapesJS — solo los campos que nos importan. */
interface GrapesJSComponentLike {
  type?: string;
  attributes?: Record<string, unknown>;
  components?: GrapesJSComponentLike[];
}

interface GrapesJSProjectLike {
  pages?: Array<{ frames?: Array<{ component?: GrapesJSComponentLike }> }>;
}

/** Estado del último pase: cuántos componentes se anotaron / corrigieron. */
export interface ReInjectReport {
  /** Componentes a los que se les añadió `data-studio-block`. */
  added: number;
  /** Componentes cuyo atributo `data-studio-block` se corrigió (valor
   *  incorrecto). */
  corrected: number;
  /** Componentes studio-* encontrados que NO tienen un block id conocido
   *  (debería ser 0 — defensa). */
  unknown: number;
}

/** Recorre el árbol del proyecto y anota cada componente studio-* con
 *  `data-studio-block`. Idempotente.
 *
 *  @param project Proyecto GrapesJS (mutado in-place).
 *  @returns Reporte de la operación.
 *  @throws TypeError si el proyecto no es un objeto o no tiene `pages`.
 */
export function reInjectMarkers(project: unknown): ReInjectReport {
  if (!project || typeof project !== "object") {
    throw new TypeError("reInjectMarkers: el proyecto debe ser un objeto");
  }
  const p = project as GrapesJSProjectLike;
  if (!Array.isArray(p.pages)) {
    throw new TypeError("reInjectMarkers: el proyecto debe tener `pages` array");
  }

  const report: ReInjectReport = { added: 0, corrected: 0, unknown: 0 };

  for (const page of p.pages) {
    if (!page || !Array.isArray(page.frames)) continue;
    for (const frame of page.frames) {
      if (!frame || !frame.component) continue;
      walkComponent(frame.component, report);
    }
  }

  return report;
}

function walkComponent(node: GrapesJSComponentLike, report: ReInjectReport): void {
  if (!node || typeof node !== "object") return;

  const type = node.type;
  if (typeof type === "string" && type.startsWith("studio-")) {
    const expectedId = STUDIO_TYPE_TO_BLOCK_ID[type];
    if (!expectedId || !isStudioBlockId(expectedId)) {
      report.unknown++;
    } else {
      if (!node.attributes) {
        node.attributes = {};
      }
      const existing = node.attributes["data-studio-block"];
      if (existing === undefined) {
        node.attributes["data-studio-block"] = expectedId;
        report.added++;
      } else if (existing !== expectedId) {
        // Corrige si el docente lo editó a mano y puso un valor distinto.
        node.attributes["data-studio-block"] = expectedId;
        report.corrected++;
      }
    }
  }

  if (Array.isArray(node.components)) {
    for (const child of node.components) {
      walkComponent(child, report);
    }
  }
}
