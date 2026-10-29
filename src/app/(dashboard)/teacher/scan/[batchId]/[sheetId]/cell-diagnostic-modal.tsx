"use client";

import { useEffect } from "react";
import type { AnswerKey } from "@/modules/scanning/domain/answer-sheet";
import type { BubbleState } from "@/modules/scanning/domain/bubble-classification";
import type { MatrixRow } from "./sheet-matrix";

interface CellDiagnosticModalProps {
  row: MatrixRow;
  answerKeys: readonly AnswerKey[];
  processedImagePath: string | null;
  /** Recorte del escaneo para este ítem (JPEG en base64, sin el prefijo
   *  data:). `null` si la hoja no tiene recortes persistidos o si todavía no
   *  llegaron. Es la evidencia visual de qué marcó el estudiante: los números
   *  de relleno dicen cuánto, la imagen dice qué se ve en el papel. */
  crop: string | null;
  cropCargando: boolean;
  onClose: () => void;
}

export function CellDiagnosticModal({
  row,
  answerKeys,
  processedImagePath,
  crop,
  cropCargando,
  onClose,
}: CellDiagnosticModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cellsByKey = new Map(row.cells.map((c) => [c.key, c]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cell-modal-title"
      onClick={onClose}
    >
      <div
        className="bg-card max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 id="cell-modal-title" className="text-lg font-semibold">
            Pregunta {row.questionNumber ?? ""}{" "}
            <span className="text-muted-foreground text-sm font-normal">
              · {row.selectedKey ? `Marcada ${row.selectedKey}` : "Sin marcar"}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-2xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="bg-muted/30 mb-4 rounded-lg border p-4">
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: row.questionTextHtml }}
          />
        </div>

        <div className="mb-4">
          <h4 className="mb-2 text-sm font-semibold">Marca en el papel</h4>
          {crop ? (
            <div className="bg-muted/30 overflow-x-auto rounded-lg border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${crop}`}
                alt={`Recorte del escaneo para la pregunta ${row.questionNumber ?? ""}`}
                className="mx-auto max-w-full"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
          ) : (
            <p className="text-muted-foreground bg-muted/30 rounded-lg border p-3 text-xs">
              {cropCargando
                ? "Cargando el recorte…"
                : "Esta hoja no tiene recortes guardados. Se generan al procesarla; usa «Reprocesar» si los necesitas."}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 text-sm font-semibold">Lectura del escáner</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="py-1 text-left font-medium">Opción</th>
                  <th className="py-1 text-right font-medium">Relleno</th>
                  <th className="py-1 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {/* Solo las opciones del ítem: listar A-H en una pregunta de
                    4 inventa cuatro filas "vacías" que en el papel no existen. */}
                {answerKeys
                  .filter((k) => row.optionKeys.includes(k))
                  .map((k) => {
                    const c = cellsByKey.get(k);
                    const fill = c ? Math.round(c.fillRatio * 100) : 0;
                    const state: BubbleState = c?.state ?? "EMPTY";
                    const isSelected = row.selectedKey === k;
                    return (
                      <tr key={k} className={isSelected ? "bg-amber-50" : ""}>
                        <td className="py-1 font-mono">{k}</td>
                        <td className="py-1 text-right">
                          <FillBar value={fill} tone={stateBarTone(state, k === row.correctKey)} />
                        </td>
                        <td className="py-1 text-right">
                          <StateBadge
                            state={state}
                            isSelected={isSelected}
                            isCorrectKey={k === row.correctKey}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">Resumen</h4>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Respuesta correcta</dt>
                <dd className="font-mono font-semibold">{row.correctKey}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Marcada</dt>
                <dd className="font-mono">{row.selectedKey ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Confianza</dt>
                <dd>{row.fillRatio != null ? `${Math.round(row.fillRatio * 100)}%` : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Resultado</dt>
                <dd>
                  {row.disabled ? (
                    <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs">
                      No cuenta
                    </span>
                  ) : row.isAmbiguous ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                      Múltiple marca
                    </span>
                  ) : row.isCorrect === true ? (
                    <span className="font-semibold text-emerald-700">Correcta</span>
                  ) : row.isCorrect === false ? (
                    <span className="font-semibold text-rose-700">Incorrecta</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
            </dl>

            {processedImagePath && (
              <div className="mt-4">
                <p className="text-muted-foreground mb-2 text-xs">
                  Overlay generado por el worker (bbox rojo = marca leída).
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={processedImagePath}
                  alt="Overlay del detector OMR"
                  className="bg-muted max-h-48 w-full rounded border object-contain"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function stateBarTone(state: BubbleState, isCorrectKey: boolean): "muted" | "warn" | "good" {
  if (state === "AMBIGUOUS") return "warn";
  if (state === "MARKED" && isCorrectKey) return "good";
  return "muted";
}

function FillBar({ value, tone }: { value: number; tone: "muted" | "warn" | "good" }) {
  const color =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-muted-foreground/30";
  return (
    <span className="inline-flex w-32 items-center gap-2">
      <span className="bg-muted relative h-2 w-24 overflow-hidden rounded">
        <span className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${value}%` }} />
      </span>
      <span className="text-xs tabular-nums">{value}%</span>
    </span>
  );
}

function StateBadge({
  state,
  isSelected,
  isCorrectKey,
}: {
  state: BubbleState;
  isSelected: boolean;
  isCorrectKey: boolean;
}) {
  if (!isSelected) return <span className="text-muted-foreground text-xs">—</span>;
  if (state === "MARKED" && isCorrectKey) {
    return <span className="text-xs text-emerald-700">✓</span>;
  }
  if (state === "MARKED" && !isCorrectKey) {
    return <span className="text-xs text-rose-700">✗</span>;
  }
  return <span className="bg-amber-100 text-xs text-amber-900">AMBIG</span>;
}
