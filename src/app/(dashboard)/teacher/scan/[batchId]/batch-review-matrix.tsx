"use client";

import { Download } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SheetRow {
  id: string;
  label: string;
  status: string;
  score: number | null;
  totalCorrect: number | null;
  totalQuestions: number | null;
  thr: number | null;
  /** Respuestas detectadas en orden (n 1-based). `ans` ∈ {"A".."H","BLANCO","MULTIPLE:XY"}. */
  answers: { n: number; ans: string }[];
  /** Contenido crudo del QR tal como se leyó del papel; `null` si fue ilegible. */
  qrContent: string | null;
  /** Nombre del escaneo tal como quedó guardado (no el nombre original subido). */
  fileName: string | null;
}

interface Fill {
  l: string;
  f: number;
  m: boolean;
}
interface CellQuestion {
  n: number;
  ans: string;
  fills: Fill[];
  crop: string;
}
interface CellsDoc {
  thr: number | null;
  questions: CellQuestion[];
}

const LETTERS = "ABCDEFGH";

/** "BLANCO"→"BL"; "MULTIPLE:BC"→"(B,C)"; letra→letra. */
function shortAns(a: string): string {
  if (a === "BLANCO") return "BL";
  if (a.startsWith("MULTIPLE:")) return "(" + a.slice(9).split("").join(",") + ")";
  return a;
}

/** Contenido completo del QR de la hoja seleccionada.
 *
 *  Se muestra crudo, tal como venía impreso: es lo que permite auditar a qué
 *  cuadernillo y a qué hoja física pertenece la que se está revisando, y es el
 *  mismo texto sobre el que se verifica la firma HMAC. Si el payload no es
 *  JSON se muestra el texto tal cual en vez de fallar. */
function QrPanel({ qrContent }: { qrContent: string | null }) {
  let campos: [string, string][] | null = null;
  if (qrContent) {
    try {
      const parsed: unknown = JSON.parse(qrContent);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        campos = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]);
      }
    } catch {
      // no es JSON: cae al render crudo de abajo
    }
  }
  return (
    <div className="bg-muted/40 mt-3 rounded-md border p-2.5 font-mono text-[11px] leading-relaxed break-all">
      <span className="text-muted-foreground mb-1 block font-sans text-[10px] font-bold tracking-wide uppercase">
        QR
      </span>
      {!qrContent ? (
        <span className="font-sans text-amber-600">no se pudo leer</span>
      ) : campos ? (
        campos.map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground inline-block w-[64px]">{k}</span>
            {v}
          </div>
        ))
      ) : (
        qrContent
      )}
    </div>
  );
}

export function BatchReviewMatrix({ batchId, rows }: { batchId: string; rows: SheetRow[] }) {
  const nItems = useMemo(() => rows.reduce((m, s) => Math.max(m, s.answers.length), 0), [rows]);

  const [sel, setSel] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  // "r,c" -> letra corregida (solo en cliente, como el PoC).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // Cache de recortes por hoja (carga perezosa vía /api/scans/cells).
  const [cells, setCells] = useState<Record<string, CellsDoc>>({});
  const gridRef = useRef<HTMLDivElement>(null);

  const metrics = useMemo(() => {
    let blank = 0;
    let multi = 0;
    for (const s of rows) {
      for (const a of s.answers) {
        if (a.ans === "BLANCO") blank++;
        else if (a.ans.startsWith("MULTIPLE")) multi++;
      }
    }
    return { sheets: rows.length, items: nItems, blank, multi };
  }, [rows, nItems]);

  // Carga perezosa del JSON de recortes de la hoja seleccionada.
  useEffect(() => {
    const sheet = rows[sel.r];
    if (!sheet || cells[sheet.id]) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scans/cells/${batchId}/${sheet.id}`);
        const doc: CellsDoc = res.ok ? await res.json() : { thr: null, questions: [] };
        if (!cancelled) setCells((c) => ({ ...c, [sheet.id]: doc }));
      } catch {
        if (!cancelled) setCells((c) => ({ ...c, [sheet.id]: { thr: null, questions: [] } }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sel.r, rows, batchId, cells]);

  const cellText = useCallback(
    (r: number, c: number): string => {
      const ov = overrides[`${r},${c}`];
      if (ov !== undefined) return ov;
      const a = rows[r]?.answers[c];
      return a ? shortAns(a.ans) : "";
    },
    [overrides, rows],
  );

  const cellTone = useCallback(
    (r: number, c: number): string => {
      if (overrides[`${r},${c}`] !== undefined) return "bg-brand-blue-tint text-primary font-bold";
      const a = rows[r]?.answers[c];
      if (!a) return "";
      if (a.ans === "BLANCO")
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
      if (a.ans.startsWith("MULTIPLE")) return "bg-brand-mint-tint text-brand-mint-foreground";
      return "";
    },
    [overrides, rows],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const key = e.key;
      if (key === "ArrowRight") setSel((s) => ({ ...s, c: Math.min(nItems - 1, s.c + 1) }));
      else if (key === "ArrowLeft") setSel((s) => ({ ...s, c: Math.max(0, s.c - 1) }));
      else if (key === "ArrowDown")
        setSel((s) => ({ ...s, r: Math.min(rows.length - 1, s.r + 1) }));
      else if (key === "ArrowUp") setSel((s) => ({ ...s, r: Math.max(0, s.r - 1) }));
      else if (key.length === 1 && LETTERS.includes(key.toUpperCase())) {
        setOverrides((o) => ({ ...o, [`${sel.r},${sel.c}`]: key.toUpperCase() }));
      } else if (key === "Delete" || key === "Backspace") {
        setOverrides((o) => {
          const next = { ...o };
          delete next[`${sel.r},${sel.c}`];
          return next;
        });
      } else return;
      e.preventDefault();
    },
    [nItems, rows.length, sel.r, sel.c],
  );

  // Mantener la celda seleccionada visible.
  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${sel.r}-${sel.c}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);

  function exportCsv() {
    const lines = ["hoja,item,respuesta,detectado_originalmente"];
    rows.forEach((s, r) => {
      s.answers.forEach((a, c) => {
        const ov = overrides[`${r},${c}`];
        lines.push(`"${s.label}",${a.n},${ov ?? a.ans},${a.ans}`);
      });
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "revision_omr.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const selSheet = rows[sel.r];
  const selDoc = selSheet ? cells[selSheet.id] : undefined;
  const selQ = selDoc?.questions[sel.c];
  const selThr = selSheet?.thr ?? selDoc?.thr ?? null;
  const selOverride = overrides[`${sel.r},${sel.c}`];

  return (
    <div className="space-y-4">
      {/* Métricas */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Hojas", metrics.sheets],
          ["Ítems por hoja", metrics.items],
          ["Celdas en blanco", metrics.blank],
          ["Celdas múltiples", metrics.multi],
        ].map(([label, value]) => (
          <div key={label} className="bg-card rounded-xl border p-4 shadow-sm">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {label}
            </p>
            <p className="font-display mt-1.5 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={exportCsv}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
        >
          Descargar CSV (con correcciones)
        </button>
        <span className="text-muted-foreground text-xs">
          Flechas: navegar · A–H: corregir · Supr/Backspace: restaurar valor detectado
        </span>
      </div>

      {/* Cuadrícula navegable */}
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="focus-visible:ring-ring max-h-[55vh] overflow-auto rounded-xl border focus-visible:ring-2 focus-visible:outline-none"
      >
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="bg-muted text-muted-foreground sticky top-0 left-0 z-30 border-r border-b px-3 py-2 text-left font-semibold">
                Hoja
              </th>
              {Array.from({ length: nItems }, (_, c) => (
                <th
                  key={c}
                  className="bg-muted text-muted-foreground sticky top-0 z-20 min-w-[46px] border-b px-2 py-2 text-center font-semibold"
                >
                  it{c + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s, r) => (
              <tr key={s.id}>
                <th
                  title={s.label}
                  className="bg-muted text-foreground sticky left-0 z-10 max-w-[190px] truncate border-r border-b px-3 py-1.5 text-left font-medium"
                >
                  {s.label}
                </th>
                {Array.from({ length: nItems }, (_, c) => {
                  const selected = sel.r === r && sel.c === c;
                  return (
                    <td
                      key={c}
                      data-cell={`${r}-${c}`}
                      onClick={() => {
                        setSel({ r, c });
                        gridRef.current?.focus();
                      }}
                      className={cn(
                        "min-w-[46px] cursor-pointer border-b px-2 py-1.5 text-center",
                        cellTone(r, c),
                        selected && "ring-primary ring-2 ring-inset",
                      )}
                    >
                      {cellText(r, c)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Visor de la celda seleccionada */}
      <div className="bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm sm:flex-row">
        <div className="bg-muted flex h-56 w-full items-center justify-center overflow-hidden rounded-lg border sm:w-72">
          {selQ && selQ.crop ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:image/jpeg;base64,${selQ.crop}`}
              alt={`Ítem ${selQ.n}`}
              className="h-full max-w-full object-contain [image-rendering:pixelated]"
            />
          ) : (
            <span className="text-muted-foreground text-sm">
              {selDoc ? "Sin recorte para esta celda." : "Cargando recorte…"}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          {selSheet ? (
            <>
              <p className="font-display text-base font-semibold">
                {selSheet.label} — Ítem {selQ?.n ?? sel.c + 1}
              </p>
              {selSheet.fileName && (
                <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-xs">
                  <span className="truncate">{selSheet.fileName}</span>
                  {/* `download` sin valor: el nombre lo pone la cabecera
                      Content-Disposition de la ruta, que conoce el nombre
                      original con el que se subio el archivo. */}
                  <a
                    href={`/api/scans/file/${batchId}/${selSheet.id}`}
                    download
                    title={`Descargar ${selSheet.fileName}`}
                    aria-label={`Descargar ${selSheet.fileName}`}
                    className="hover:bg-muted hover:text-foreground shrink-0 rounded p-1 transition-colors"
                  >
                    <Download className="size-3.5" aria-hidden />
                  </a>
                </p>
              )}
              <p className="mt-1">
                Detectado:{" "}
                <span className="font-semibold">{selSheet.answers[sel.c]?.ans ?? "—"}</span>
                {selOverride !== undefined && (
                  <>
                    {" "}
                    → corregido a <span className="text-primary font-bold">{selOverride}</span>
                  </>
                )}
              </p>
              {selThr !== null && (
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Umbral de marcado: {selThr.toFixed(3)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {selQ?.fills.map((f) => (
                  <span
                    key={f.l}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs",
                      f.m
                        ? "border-destructive bg-destructive/10 text-destructive font-bold"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {f.l}: {f.f.toFixed(2)}
                  </span>
                ))}
              </div>
              <QrPanel qrContent={selSheet.qrContent} />
            </>
          ) : (
            <p className="text-muted-foreground">Selecciona una celda…</p>
          )}
        </div>
      </div>
    </div>
  );
}
