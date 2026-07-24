"use client";

import { useEffect, useRef, useState } from "react";
import type { QuestionExtractProgress } from "@/modules/question-import/domain/question-import-queue";

/**
 * Suscripción SSE al progreso de un job de extracción IA.
 *
 * Renderiza una barra de progreso viva (fase + contadores) mientras el
 * worker procesa; cuando llega `done` o `error` invoca el callback del
 * padre y deja de escuchar.
 *
 * Implementación: `EventSource` nativa del navegador. No usamos una
 * librería porque la ruta `/api/import/{jobId}/stream` ya emite eventos
 * en formato `data: <json>\n\n`, que es exactamente lo que `EventSource`
 * parsea.
 *
 * Por qué polling de respaldo: si el SSE se cae por un proxy intermedio
 * o un timeout, el componente sigue recibiendo el último progreso
 * persistido en BD vía re-montaje. Para eso también consultamos
 * `/api/import/{jobId}` cuando el evento `error` del EventSource se
 * dispara sin que tengamos un `data` parseable.
 */
interface Props {
  jobId: string;
  onDone: (questions: unknown[], warnings: string[]) => void;
  onError: (error: string) => void;
}

interface StreamState {
  phase: QuestionExtractProgress | null;
  message: string;
}

const PHASE_LABEL: Record<QuestionExtractProgress["phase"], string> = {
  queued: "En cola",
  split: "Dividiendo PDF en fragmentos",
  extract: "Extrayendo preguntas",
  "extract-done": "Preguntas extraídas",
  solve: "Determinando respuestas correctas",
  images: "Recortando figuras del PDF",
  uploading: "Subiendo figuras al servidor",
  assemble: "Armando el resultado final",
};

function describePhase(progress: QuestionExtractProgress): string {
  const base = PHASE_LABEL[progress.phase] ?? progress.phase;
  switch (progress.phase) {
    case "split":
      return `${base} · ${progress.chunks} fragmento(s)`;
    case "extract":
      return `${base} · fragmento ${progress.chunk}/${progress.of}`;
    case "extract-done":
      return `${base} · ${progress.questions} pregunta(s) en ${progress.contexts} contexto(s)`;
    case "solve":
      return `${base} · ${progress.solved}/${progress.of}`;
    case "images":
      return `${base} · ${progress.done}/${progress.of}`;
    case "uploading":
      return `${base} · ${progress.figuresDone}/${progress.of}`;
    case "assemble":
      return `${base} · ${progress.questions} pregunta(s)`;
    case "queued":
      return base;
  }
}

export function ImportStream({ jobId, onDone, onError }: Props) {
  const [state, setState] = useState<StreamState>({ phase: null, message: "Conectando…" });
  const finishedRef = useRef(false);

  useEffect(() => {
    finishedRef.current = false;

    const es = new EventSource(`/api/import/${jobId}/stream`);

    es.onmessage = (ev) => {
      if (finishedRef.current) return;
      try {
        const data = JSON.parse(ev.data) as
          | { type: "progress"; progress: QuestionExtractProgress }
          | { type: "done"; questions: unknown[]; warnings: string[] }
          | { type: "error"; error: string };

        if (data.type === "progress") {
          setState({ phase: data.progress, message: describePhase(data.progress) });
        } else if (data.type === "done") {
          finishedRef.current = true;
          es.close();
          onDone(data.questions, data.warnings);
        } else if (data.type === "error") {
          finishedRef.current = true;
          es.close();
          onError(data.error);
        }
      } catch {
        // Mensaje mal formado: lo ignoramos (el siguiente evento traerá
        // un JSON válido).
      }
    };

    es.onerror = () => {
      // El navegador ya re-intenta solo. Si ya terminamos, cerramos.
      if (finishedRef.current) {
        es.close();
        return;
      }
      // Si no, mostramos un mensaje suave; el SSE re-intenta abrirse.
      setState((prev) => ({ ...prev, message: "Reintentando conexión…" }));
    };

    return () => {
      es.close();
    };
  }, [jobId, onDone, onError]);

  return (
    <section className="bg-card space-y-3 rounded-xl border p-6">
      <h2 className="font-semibold">Extrayendo preguntas con IA…</h2>
      <p className="text-muted-foreground text-sm">{state.message}</p>
      <ProgressBar phase={state.phase} />
      <p className="text-muted-foreground text-xs">
        Esto puede tomar entre 20 segundos y un par de minutos según el tamaño del PDF. Podés
        dejar la pestaña abierta o volver más tarde: tu progreso se guarda automáticamente.
      </p>
    </section>
  );
}

function ProgressBar({ phase }: { phase: QuestionExtractProgress | null }) {
  // Ponderación relativa de cada fase — no refleja tiempo real (solve con
  // Opus + thinking es lo más caro), pero da una sensación de avance al
  // usuario. La barra es solo cosmética: el estado real está en BD.
  const order: QuestionExtractProgress["phase"][] = [
    "queued",
    "split",
    "extract",
    "extract-done",
    "solve",
    "images",
    "uploading",
    "assemble",
  ];
  const idx = phase ? order.indexOf(phase.phase) : -1;
  const pct = idx < 0 ? 0 : Math.round(((idx + 1) / order.length) * 100);

  return (
    <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
      <div
        className="bg-primary h-full transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}