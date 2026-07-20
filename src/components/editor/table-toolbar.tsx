"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

/** Tamaño máximo que ofrece la rejilla. Para más, están los inputs. */
const GRID = 8;

/**
 * El alto de fila se guarda en px porque es lo que espera el atributo HTML
 * `height`, pero al docente se le pregunta en MILÍMETROS: está maquetando una
 * hoja de examen, no una pantalla.
 *
 * La equivalencia es exacta y no depende del monitor: en impresión un px CSS
 * es 1/96 de pulgada por definición.
 */
const PX_PER_MM = 96 / 25.4;

function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM);
}

function pxToMm(px: number): number {
  return Math.round(px / PX_PER_MM);
}

function Btn({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`h-7 rounded px-2 text-xs whitespace-nowrap ${
        danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Botón de insertar tabla con selector de tamaño.
 *
 * Rejilla al estilo de Word/Docs: se pasa el cursor y se ve cuántas filas y
 * columnas van a salir antes de soltar. Debajo, dos campos para tamaños que
 * no caben en la rejilla.
 */
export function TableInsertButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [withHeader, setWithHeader] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // Cierra al hacer clic fuera o con Escape: el panel flota sobre el editor y
  // dejarlo abierto tapa el texto.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function insert(r: number, c: number) {
    const safeRows = Math.max(1, Math.min(20, r));
    const safeCols = Math.max(1, Math.min(10, c));
    editor
      .chain()
      .focus()
      .insertTable({ rows: safeRows, cols: safeCols, withHeaderRow: withHeader })
      .run();
    setOpen(false);
    setHover({ rows: 0, cols: 0 });
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        title="Insertar tabla"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className={`h-7 min-w-7 rounded px-1.5 text-sm ${
          open ? "bg-primary text-primary-foreground" : "hover:bg-accent"
        }`}
      >
        ▦
      </button>

      {open ? (
        <div className="bg-popover absolute top-8 left-0 z-20 w-max rounded-md border p-2 shadow-md">
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${GRID}, 1rem)` }}
            onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
          >
            {Array.from({ length: GRID * GRID }, (_, i) => {
              const r = Math.floor(i / GRID) + 1;
              const c = (i % GRID) + 1;
              const on = r <= hover.rows && c <= hover.cols;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`${r} × ${c}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHover({ rows: r, cols: c })}
                  onClick={() => insert(r, c)}
                  className={`h-4 w-4 rounded-[2px] border ${
                    on ? "bg-primary border-primary" : "border-input bg-background"
                  }`}
                />
              );
            })}
          </div>

          <p className="text-muted-foreground mt-1.5 text-center text-xs">
            {hover.rows > 0 ? `${hover.rows} × ${hover.cols}` : "Elige el tamaño"}
          </p>

          <div className="mt-2 flex items-end gap-1 border-t pt-2">
            <label className="text-muted-foreground text-xs">
              Filas
              <input
                type="number"
                min={1}
                max={20}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="border-input bg-background ml-1 h-7 w-12 rounded border px-1 text-sm"
              />
            </label>
            <label className="text-muted-foreground text-xs">
              Cols
              <input
                type="number"
                min={1}
                max={10}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
                className="border-input bg-background ml-1 h-7 w-12 rounded border px-1 text-sm"
              />
            </label>
            <Btn onClick={() => insert(rows, cols)} title="Insertar con ese tamaño">
              Insertar
            </Btn>
          </div>

          <label className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={withHeader}
              onChange={(e) => setWithHeader(e.target.checked)}
              className="accent-primary"
            />
            Primera fila como encabezado
          </label>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Controles de fila/columna. Solo se muestran con el cursor dentro de una
 * tabla — fuera no tienen sentido y ocuparían sitio en la barra.
 */
export function TableControls({ editor }: { editor: Editor }) {
  if (!editor.isActive("table")) return null;
  const chain = () => editor.chain().focus();

  /** Alto de la fila donde está el cursor, en px (null = automático). */
  const rowHeight = (editor.getAttributes("tableRow").height as number | null) ?? null;
  const setRowHeight = (height: number | null) =>
    editor.chain().focus().updateAttributes("tableRow", { height }).run();

  return (
    <div className="bg-muted/20 flex flex-wrap items-center gap-0.5 border-b px-1 py-0.5">
      <span className="text-muted-foreground mr-1 text-xs font-medium">Tabla:</span>

      <Btn onClick={() => chain().addRowBefore().run()} title="Insertar fila encima">
        ↑+ fila
      </Btn>
      <Btn onClick={() => chain().addRowAfter().run()} title="Insertar fila debajo">
        ↓+ fila
      </Btn>
      <Btn onClick={() => chain().deleteRow().run()} title="Eliminar la fila actual" danger>
        − fila
      </Btn>

      <span className="bg-border mx-1 h-4 w-px" aria-hidden />

      <Btn onClick={() => chain().addColumnBefore().run()} title="Insertar columna a la izquierda">
        ←+ col
      </Btn>
      <Btn onClick={() => chain().addColumnAfter().run()} title="Insertar columna a la derecha">
        →+ col
      </Btn>
      <Btn onClick={() => chain().deleteColumn().run()} title="Eliminar la columna actual" danger>
        − col
      </Btn>

      <span className="bg-border mx-1 h-4 w-px" aria-hidden />

      <label
        className="text-muted-foreground flex items-center gap-1 text-xs"
        title="Alto de la fila actual. Vacío = se ajusta al contenido."
      >
        Alto
        <input
          type="number"
          min={0}
          max={120}
          step={5}
          value={rowHeight === null ? "" : pxToMm(rowHeight)}
          placeholder="auto"
          onChange={(e) => {
            const mm = Number(e.target.value);
            setRowHeight(
              e.target.value === "" || !Number.isFinite(mm) || mm <= 0 ? null : mmToPx(mm),
            );
          }}
          className="border-input bg-background h-6 w-14 rounded border px-1 text-xs"
        />
        mm
      </label>

      <span className="bg-border mx-1 h-4 w-px" aria-hidden />

      <Btn onClick={() => chain().toggleHeaderRow().run()} title="Activar/desactivar encabezado">
        Encabezado
      </Btn>
      <Btn onClick={() => chain().mergeOrSplit().run()} title="Combinar o dividir celdas">
        Combinar
      </Btn>
      <Btn onClick={() => chain().deleteTable().run()} title="Eliminar toda la tabla" danger>
        Eliminar tabla
      </Btn>
    </div>
  );
}
