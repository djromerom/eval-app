"use client";

import { useCallback, useState } from "react";
import { CellDiagnosticModal } from "./cell-diagnostic-modal";
import type { BubbleCellRecord, AnswerKey } from "@/modules/scanning/domain/answer-sheet";

export interface MatrixRow {
  questionId: string;
  questionNumber: number | null;
  questionTextHtml: string;
  cells: BubbleCellRecord[];
  /** Posición del ítem en la hoja completa, 1-based. Es la clave de los
   *  recortes y NO cambia aunque la tabla se filtre. */
  posicion: number;
  /** Opciones que realmente tiene este ítem ("A".."D", o "A".."H"). Una hoja
   *  mezcla preguntas de distinto número de opciones. */
  optionKeys: string[];
  selectedKey: string | null;
  correctKey: string;
  isCorrect: boolean | null;
  isAmbiguous: boolean;
  fillRatio: number | null;
  /** Pregunta inhabilitada en el cuadernillo: no suma a la nota, así que se
   *  muestra "No cuenta" en lugar de ✓/✗ y sin verde/rojo en la burbuja. */
  disabled?: boolean;
}

interface SheetMatrixProps {
  rows: MatrixRow[];
  answerKeys: readonly AnswerKey[];
  /** Ruta al overlay PNG con bboxes dibujados (recortado por color) —
   *  opcional; si falta, el modal no muestra la miniatura. */
  processedImagePath: string | null;
  /** Para pedir los recortes por pregunta a /api/scans/cells/<batch>/<sheet>. */
  batchId: string;
  sheetId: string;
}

/** Recortes del escaneo por número de pregunta, en base64. Se piden una sola
 *  vez, la primera vez que se abre un detalle: el JSON completo ronda el MB en
 *  una hoja de 95 ítems y no tiene sentido cargarlo con la página cuando la
 *  mayoría de las visitas solo miran la matriz. */
type Recortes = Map<number, string>;

type CellTone = "blank" | "wrong" | "right" | "multiple" | "ambiguous" | "notCounted";

function toneFor(
  isMarked: boolean,
  isCorrect: boolean | null,
  isSelected: boolean,
  state: BubbleCellRecord["state"],
  disabled = false,
): CellTone {
  if (!isMarked) return "blank";
  if (state === "AMBIGUOUS") return "ambiguous";
  if (!isSelected) return "blank";
  if (disabled) return "notCounted";
  if (isCorrect === true) return "right";
  if (isCorrect === false) return "wrong";
  return "blank";
}

const toneClasses: Record<CellTone, string> = {
  blank: "bg-white text-muted-foreground border-border hover:border-foreground/40",
  right: "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600",
  wrong: "bg-rose-500 text-white border-rose-600 hover:bg-rose-600",
  multiple: "bg-amber-400 text-amber-900 border-amber-500 hover:bg-amber-500",
  ambiguous: "bg-amber-100 text-amber-900 border-amber-400 border-dashed hover:bg-amber-200",
  notCounted: "bg-slate-400 text-white border-slate-500 hover:bg-slate-500",
};

export function SheetMatrix({
  rows,
  answerKeys,
  processedImagePath,
  batchId,
  sheetId,
}: SheetMatrixProps) {
  // Se guarda también el índice: es la clave de los recortes (ver `abrir`).
  const [abierto, setAbierto] = useState<MatrixRow | null>(null);

  // Columnas = unión de las opciones presentes, en el orden canónico. Si
  // ninguna pregunta llega a E-H, esas columnas no se dibujan; si alguna sí,
  // la columna existe pero las filas de 4 opciones la dejan vacía en vez de
  // pintar una burbuja que en el papel no existe.
  const columnas = answerKeys.filter((k) => rows.some((r) => r.optionKeys.includes(k)));
  const [recortes, setRecortes] = useState<Recortes | null>(null);
  const [cargandoRecortes, setCargandoRecortes] = useState(false);

  /** La clave de los recortes es `row.posicion`, la posición del ítem en la
   *  hoja COMPLETA — no el índice en el array, que cambia al filtrar por
   *  asignatura, ni `row.questionNumber`, que en un cuadernillo es
   *  `bundleItem.order` y se repite en decenas de filas. */
  const abrir = useCallback(
    (row: MatrixRow) => {
      setAbierto(row);
      if (recortes || cargandoRecortes) return;
      setCargandoRecortes(true);
      fetch(`/api/scans/cells/${batchId}/${sheetId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { questions?: { n: number; crop?: string }[] } | null) => {
          // Sin recortes el modal sigue sirviendo: solo no muestra la imagen.
          setRecortes(
            new Map((d?.questions ?? []).filter((q) => q.crop).map((q) => [q.n, q.crop!])),
          );
        })
        .catch(() => setRecortes(new Map()))
        .finally(() => setCargandoRecortes(false));
    },
    [batchId, sheetId, recortes, cargandoRecortes],
  );

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded border border-dashed p-8 text-center text-sm">
        Esta hoja aún no tiene respuestas calificadas. Usa &quot;Reprocesar&quot; si lleva mucho
        tiempo en este estado, o espera a que el worker termine.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" role="grid">
          <thead>
            <tr>
              <th className="bg-muted/40 text-muted-foreground w-20 border-r border-b px-3 py-2 text-left font-medium">
                #
              </th>
              <th
                className="bg-muted/40 text-muted-foreground border-r border-b px-3 py-2 text-left font-medium"
                style={{ minWidth: 240 }}
              >
                Pregunta
              </th>
              {columnas.map((k) => (
                <th
                  key={k}
                  className="bg-muted/40 text-muted-foreground w-12 border-b px-2 py-2 text-center font-medium"
                  scope="col"
                >
                  {k}
                </th>
              ))}
              <th className="bg-muted/40 text-muted-foreground w-24 border-b border-l px-3 py-2 text-left font-medium">
                Correcta
              </th>
              <th className="bg-muted/40 text-muted-foreground w-24 border-b border-l px-3 py-2 text-center font-medium">
                Marca
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const cellsByKey = new Map(row.cells.map((c) => [c.key, c]));
              return (
                <tr
                  key={`${row.questionId}-${idx}`}
                  className={
                    row.disabled ? "bg-muted/40 text-muted-foreground align-middle" : "align-middle"
                  }
                >
                  <td className="text-muted-foreground border-r border-b px-3 py-1 text-center font-mono text-xs">
                    {row.posicion}
                  </td>
                  <td
                    className="border-r border-b px-3 py-2"
                    style={{ maxWidth: 360 }}
                    title={row.questionTextHtml}
                  >
                    <div
                      className="prose prose-sm max-w-none overflow-hidden text-ellipsis whitespace-nowrap"
                      dangerouslySetInnerHTML={{ __html: row.questionTextHtml }}
                    />
                  </td>
                  {columnas.map((k) => {
                    if (!row.optionKeys.includes(k)) {
                      // El ítem no tiene esta opción: celda vacía, no una
                      // burbuja "sin marcar" que no existe en el papel.
                      return <td key={k} className="bg-muted/20 border-b" aria-hidden="true" />;
                    }
                    const cell = cellsByKey.get(k);
                    const isMarked = !!cell?.isMarked;
                    const state = cell?.state ?? "EMPTY";
                    const isSelected = row.selectedKey === k;
                    const tone = toneFor(isMarked, row.isCorrect, isSelected, state, row.disabled);
                    const fillPct = cell ? Math.round(cell.fillRatio * 100) : 0;
                    const label = `${k}: ${fillPct}% relleno${state !== "EMPTY" ? ` (${state})` : ""}`;
                    return (
                      <td key={k} className="border-b p-1 text-center">
                        <button
                          type="button"
                          onClick={() => abrir(row)}
                          aria-label={label}
                          title={label}
                          className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${toneClasses[tone]}`}
                        >
                          {k}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-l px-3 py-2 text-center">
                    {row.disabled ? (
                      <span
                        className="bg-muted text-muted-foreground inline-block rounded px-2 py-0.5 text-xs"
                        title="Pregunta inhabilitada en el cuadernillo: no suma a la nota"
                      >
                        No cuenta
                      </span>
                    ) : row.isAmbiguous ? (
                      <span
                        className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900"
                        title="Marcó varias respuestas"
                      >
                        Múltiple
                      </span>
                    ) : row.isCorrect === true ? (
                      <span className="text-emerald-700">✓ Correcta</span>
                    ) : row.isCorrect === false ? (
                      <span className="text-rose-700">✗ {row.correctKey}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="border-b border-l px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => abrir(row)}
                      className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
                      title="Ver el recorte del escaneo para este ítem"
                    >
                      {row.selectedKey ? `Ver ${row.selectedKey}` : "Ver marca"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground mt-3 flex flex-wrap gap-3 text-xs">
        <Legend tone="right" label="Correcta" />
        <Legend tone="wrong" label="Incorrecta" />
        <Legend tone="ambiguous" label="Ambigua (revisar manualmente)" />
        <Legend tone="blank" label="Sin marcar" />
        {rows.some((r) => r.disabled) ? <Legend tone="notCounted" label="No cuenta" /> : null}
      </div>

      {abierto && (
        <CellDiagnosticModal
          crop={recortes?.get(abierto.posicion) ?? null}
          cropCargando={cargandoRecortes}
          row={abierto}
          answerKeys={answerKeys}
          processedImagePath={processedImagePath}
          onClose={() => setAbierto(null)}
        />
      )}
    </>
  );
}

function Legend({ tone, label }: { tone: CellTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-4 w-4 rounded-full border ${toneClasses[tone]}`} />
      {label}
    </span>
  );
}
