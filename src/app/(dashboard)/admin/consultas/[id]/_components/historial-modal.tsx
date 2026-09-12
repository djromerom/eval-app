"use client";

import { useEffect } from "react";
import Link from "next/link";
import type {
  CalificacionRow,
  EntradaHistorial,
} from "@/modules/consultas/domain/queries/calificaciones/calificacion-row";
import { etiquetaEstado } from "@/modules/consultas/domain/queries/calificaciones/estado";

/** Historial de hojas de un estudiante en una prueba.
 *
 *  La consulta reporta una sola calificación por estudiante — la de la hoja
 *  modificada más recientemente. Este modal muestra de dónde salió esa
 *  decisión: todas las hojas cargadas, con su fecha, para poder responder
 *  "¿por qué esta nota y no la del escaneo anterior?" sin salir de la tabla. */
export function HistorialModal({
  fila,
  onClose,
}: {
  fila: CalificacionRow;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fmt = (d: Date) =>
    new Date(d).toLocaleString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="historial-title"
      onClick={onClose}
    >
      <div
        className="bg-card max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <h3 id="historial-title" className="text-lg font-semibold">
            {fila.studentName}
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
        <p className="text-muted-foreground mb-4 text-sm">
          {fila.assessmentName} · {fila.courseName} / {fila.groupName} ·{" "}
          {fila.historial.length === 1
            ? "1 hoja cargada"
            : `${fila.historial.length} hojas cargadas`}
        </p>

        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-xs">
            <tr>
              <th className="py-2 text-left font-medium">Fecha</th>
              <th className="py-2 text-left font-medium">Estado</th>
              <th className="py-2 text-right font-medium">Aciertos</th>
              <th className="py-2 text-right font-medium">Puntaje</th>
              <th className="py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {fila.historial.map((h: EntradaHistorial) => (
              <tr
                key={h.sheetId}
                className={h.vigente ? "border-b bg-emerald-50/60" : "text-muted-foreground border-b"}
              >
                <td className="py-2">
                  {fmt(h.fecha)}
                  {h.vigente && (
                    <span className="ml-2 rounded border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      VIGENTE
                    </span>
                  )}
                </td>
                <td className="py-2">{etiquetaEstado(h.estado)}</td>
                <td className="py-2 text-right tabular-nums">
                  {h.totalCorrect !== null ? `${h.totalCorrect} / ${h.totalQuestions}` : "—"}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {h.puntaje !== null ? h.puntaje.toFixed(1) : "—"}
                </td>
                <td className="py-2 text-right">
                  {h.batchId && (
                    <Link
                      href={`/teacher/scan/${h.batchId}/${h.sheetId}/resumen?soloLectura=1&volver=${encodeURIComponent(
                        "/admin/consultas/calificaciones",
                      )}`}
                      className="text-primary text-xs underline underline-offset-2"
                    >
                      Ver
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {fila.historial.length > 1 && (
          <p className="text-muted-foreground mt-4 text-xs">
            Se reporta la hoja modificada más recientemente. Las anteriores quedan como registro:
            no se borran ni se recalculan.
          </p>
        )}
      </div>
    </div>
  );
}
