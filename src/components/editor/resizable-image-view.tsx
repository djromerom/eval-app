"use client";

import { useCallback, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/** Límites del ancho en % del contenedor. Menos de 10% es ilegible impreso. */
const MIN_PCT = 10;
const MAX_PCT = 100;

/** Posiciones de los 4 tiradores en las esquinas. */
type HandlePosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Cursor + posición de cada esquina. `nwse-resize` para ↖↘ y `nesw-resize`
 * para ↗↙ (convención CSS estándar; así se ve en Word / Google Docs / Figma).
 */
const HANDLE_POSITIONS: Record<HandlePosition, { cursor: string; className: string }> = {
  "top-left": { cursor: "nwse-resize", className: "-top-1 -left-1" },
  "top-right": { cursor: "nesw-resize", className: "-top-1 -right-1" },
  "bottom-left": { cursor: "nesw-resize", className: "-bottom-1 -left-1" },
  "bottom-right": { cursor: "nwse-resize", className: "-bottom-1 -right-1" },
};

/** Mapa de esquina a "anchor" del resize (qué lado estamos arrastrando). */
const ANCHOR_FROM_HANDLE: Record<HandlePosition, "left" | "right"> = {
  "top-left": "left",
  "top-right": "right",
  "bottom-left": "left",
  "bottom-right": "right",
};

/** Márgenes que colocan el bloque según la alineación guardada. */
function alignMargins(align: string | null): React.CSSProperties {
  switch (align) {
    case "center":
      return { marginLeft: "auto", marginRight: "auto" };
    case "right":
      return { marginLeft: "auto", marginRight: 0 };
    default:
      // `left` y `justify` (que en una imagen no significa nada) van pegadas
      // al margen izquierdo, igual que sin alineación.
      return { marginLeft: 0, marginRight: "auto" };
  }
}

/**
 * Vista de una imagen dentro del editor con tiradores en las 4 ESQUINAS
 * para redimensionarla, como en Word / Google Docs.
 *
 * Comportamiento:
 *  - 4 tiradores (↖ ↗ ↘ ↙), no en los lados.
 *  - Aspect ratio SIEMPRE se preserva: solo cambia el ancho, el alto se
 *    ajusta vía `h-auto`. Mover una esquina agranda/achica el bloque
 *    completo manteniendo proporciones.
 *  - El ancho se guarda en PORCENTAJE del ancho disponible (ver
 *    `ResizableImage` en extensions.ts): el editor y la hoja impresa tienen
 *    anchos distintos, y un valor en píxeles se vería de un tamaño en
 *    pantalla y de otro en papel.
 *  - Durante el arrastre solo se toca el estado local; el documento se
 *    actualiza al soltar. Escribir en cada `mousemove` dispararía un
 *    `onUpdate` de TipTap por evento, con su serialización del documento
 *    entera cada vez.
 */
export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  const width = (node.attrs.width as number | null) ?? null;
  const shown = preview ?? width;

  const startResize = useCallback(
    (event: React.MouseEvent, handle: HandlePosition) => {
      event.preventDefault();
      event.stopPropagation();

      // El ancho de referencia es el del contenedor del editor, no el de la
      // imagen: el porcentaje es relativo a la columna de texto.
      const parent = containerRef.current?.parentElement;
      const available = parent?.getBoundingClientRect().width ?? 0;
      if (available <= 0) return;

      const startX = event.clientX;
      const startPct =
        width ?? ((containerRef.current?.getBoundingClientRect().width ?? 0) / available) * 100;
      const anchor = ANCHOR_FROM_HANDLE[handle];

      setDragging(true);

      const onMove = (e: MouseEvent) => {
        // Mover hacia afuera agranda, hacia adentro achica. En la esquina
        // inferior-derecha, el ancla es "right" y arrastrar a la derecha
        // aumenta el ancho. Mismo razonamiento para las otras 3 esquinas:
        // siempre es "delta hacia afuera = agranda".
        const delta = anchor === "right" ? e.clientX - startX : startX - e.clientX;
        const next = startPct + (delta / available) * 100;
        setPreview(Math.round(Math.min(MAX_PCT, Math.max(MIN_PCT, next))));
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setDragging(false);
        setPreview((p) => {
          if (p !== null) updateAttributes({ width: p });
          return null;
        });
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, updateAttributes],
  );

  const showHandles = selected || dragging;

  return (
    <NodeViewWrapper
      as="div"
      ref={containerRef}
      className="relative my-2 block max-w-full"
      style={{
        ...(shown ? { width: `${shown}%` } : undefined),
        // La alineación la aplica el NodeView a mano: al controlar su propio
        // DOM no recibe la clase `ta-*` que emite `renderHTML` para el
        // servidor. Con márgenes y no con `text-align`, porque el contenedor
        // es un bloque con ancho propio.
        ...alignMargins(node.attrs.align as string | null),
      }}
      data-drag-handle
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string | null) ?? ""}
        className={`block h-auto w-full rounded ${
          selected || dragging ? "ring-primary ring-2 ring-offset-1" : ""
        }`}
        draggable={false}
      />

      {/* 4 tiradores en las esquinas. Solo aparecen con la imagen
          seleccionada, para no ensuciar la lectura del contexto mientras
          se escribe. */}
      {showHandles ? (
        <>
          <Handle position="top-left" onMouseDown={(e) => startResize(e, "top-left")} />
          <Handle position="top-right" onMouseDown={(e) => startResize(e, "top-right")} />
          <Handle position="bottom-left" onMouseDown={(e) => startResize(e, "bottom-left")} />
          <Handle position="bottom-right" onMouseDown={(e) => startResize(e, "bottom-right")} />
          <span className="bg-foreground/75 text-background pointer-events-none absolute right-1 bottom-1 rounded px-1.5 py-0.5 text-[10px] font-medium">
            {shown ?? 100}%
          </span>
        </>
      ) : null}
    </NodeViewWrapper>
  );
}

function Handle({
  position,
  onMouseDown,
}: {
  position: HandlePosition;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const { cursor, className } = HANDLE_POSITIONS[position];
  return (
    <span
      role="presentation"
      onMouseDown={onMouseDown}
      style={{ cursor }}
      className={`bg-primary absolute h-2.5 w-2.5 rounded-full ${className}`}
    />
  );
}
