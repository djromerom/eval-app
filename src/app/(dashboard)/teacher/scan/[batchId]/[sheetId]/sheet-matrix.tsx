"use client";

import { useState } from "react";
import { CellDiagnosticModal } from "./cell-diagnostic-modal";
import type { BubbleCellRecord, AnswerKey } from "@/modules/scanning/domain/answer-sheet";

export interface MatrixRow {
  questionId: string;
  questionNumber: number | null;
  questionTextHtml: string;
  cells: BubbleCellRecord[];
  selectedKey: string | null;
  correctKey: string;
  isCorrect: boolean | null;
  isAmbiguous: boolean;
  fillRatio: number | null;
}

interface SheetMatrixProps {
  rows: MatrixRow[];
  answerKeys: readonly AnswerKey[];
  /** Ruta al overlay PNG con bboxes dibujados (recortado por color) —
   *  opcional; si falta, el modal no muestra la miniatura. */
  processedImagePath: string | null;
}

type CellTone = "blank" | "wrong" | "right" | "multiple" | "ambiguous";

function toneFor(
  isMarked: boolean,
  isCorrect: boolean | null,
  isSelected: boolean,
  state: BubbleCellRecord["state"],
): CellTone {
  if (!isMarked) return "blank";
  if (state === "AMBIGUOUS") return "ambiguous";
  if (!isSelected) return "blank";
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
};

export function SheetMatrix({ rows, answerKeys, processedImagePath }: SheetMatrixProps) {
  const [openRow, setOpenRow] = useState<MatrixRow | null>(null);

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
              {answerKeys.map((k) => (
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const cellsByKey = new Map(row.cells.map((c) => [c.key, c]));
              return (
                <tr key={`${row.questionId}-${idx}`} className="align-middle">
                  <td className="text-muted-foreground border-r border-b px-3 py-1 text-center font-mono text-xs">
                    {row.questionNumber ?? idx + 1}
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
                  {answerKeys.map((k) => {
                    const cell = cellsByKey.get(k);
                    const isMarked = !!cell?.isMarked;
                    const state = cell?.state ?? "EMPTY";
                    const isSelected = row.selectedKey === k;
                    const tone = toneFor(isMarked, row.isCorrect, isSelected, state);
                    const fillPct = cell ? Math.round(cell.fillRatio * 100) : 0;
                    const label = `${k}: ${fillPct}% relleno${state !== "EMPTY" ? ` (${state})` : ""}`;
                    return (
                      <td key={k} className="border-b p-1 text-center">
                        <button
                          type="button"
                          onClick={() => setOpenRow(row)}
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
                    {row.isAmbiguous ? (
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
      </div>

      {openRow && (
        <CellDiagnosticModal
          row={openRow}
          answerKeys={answerKeys}
          processedImagePath={processedImagePath}
          onClose={() => setOpenRow(null)}
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
