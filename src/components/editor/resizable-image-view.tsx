"use client";

import { useCallback, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

/** Límites del ancho en % del contenedor. Menos de 10% es ilegible impreso. */
const MIN_PCT = 10;
const MAX_PCT = 100;

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
 * Vista de una imagen dentro del editor con tiradores para redimensionarla,
 * como en Word: se arrastra una esquina y el ancho cambia en vivo.
 *
 * El ancho se guarda en PORCENTAJE del ancho disponible (ver `ResizableImage`
 * en extensions.ts): el editor y la hoja impresa tienen anchos distintos, y
 * un valor en píxeles se vería de un tamaño en pantalla y de otro en papel.
 *
 * Durante el arrastre solo se toca el estado local; el documento se actualiza
 * al soltar. Escribir en cada `mousemove` dispararía un `onUpdate` de TipTap
 * por evento, con su serialización del documento entera cada vez.
 */
export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  const width = (node.attrs.width as number | null) ?? null;
  const shown = preview ?? width;

  const startResize = useCallback(
    (event: React.MouseEvent, anchor: "left" | "right") => {
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

      setDragging(true);

      const onMove = (e: MouseEvent) => {
        // Arrastrando el tirador izquierdo, mover a la izquierda agranda.
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

      {/* Los tiradores solo aparecen con la imagen seleccionada, para no
          ensuciar la lectura del contexto mientras se escribe. */}
      {selected || dragging ? (
        <>
          <Handle position="left" onMouseDown={(e) => startResize(e, "left")} />
          <Handle position="right" onMouseDown={(e) => startResize(e, "right")} />
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
  position: "left" | "right";
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      role="presentation"
      onMouseDown={onMouseDown}
      className={`bg-primary absolute top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-full ${
        position === "left" ? "-left-1" : "-right-1"
      }`}
    />
  );
}
