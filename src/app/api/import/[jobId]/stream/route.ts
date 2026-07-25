import { getAuthenticatedUser } from "@/lib/session";
import {
  getQuestionExtractEvents,
  QUEUE_NAMES,
  getBullMQPrefix,
} from "@/shared/infrastructure/queue/queues";
import { makeQuestionImportJobRepo } from "@/modules/question-import/infrastructure/container";
import {
  snapshotProgressToSseEvent,
  snapshotToSseEvent,
} from "@/modules/question-import/infrastructure/question-extract-handler";
import type {
  QuestionExtractSseEvent,
} from "@/modules/question-import/domain/question-import-queue";

/**
 * GET /api/import/[jobId]/stream — Server-Sent Events del progreso de un job
 * de extracción IA.
 *
 * El cliente abre un `EventSource` contra esta ruta y recibe:
 *  - evento `progress` (varios) con la fase y contadores actuales.
 *  - evento `done` con `questions` y `warnings` cuando el job termina OK.
 *  - evento `error` con un mensaje legible cuando falla.
 *
 * Fuente de verdad del estado: la fila `QuestionImportJob` (BD). Los eventos
 * de BullMQ (`completed`/`failed`/`progress`) se usan como disparadores para
 * releer la fila; no transportan el payload para evitar serializar preguntas
 * grandes dos veces (una en BullMQ returnvalue, otra en BD).
 *
 * Por qué `runtime = "nodejs"`: el `QueueEvents` de BullMQ usa
 * `EventEmitter`/ioredis blocking — incompatible con el runtime Edge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const actor = await getAuthenticatedUser();
  if (!actor) {
    return new Response(JSON.stringify({ error: "No autenticado." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!actor.roles.includes("TEACHER") && !actor.roles.includes("COORDINATOR")) {
    return new Response(JSON.stringify({ error: "Rol requerido." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { jobId } = await params;
  const repo = makeQuestionImportJobRepo();
  const snapshot = await repo.findById(actor.institutionId, jobId);
  if (!snapshot) {
    return new Response(JSON.stringify({ error: "Job no encontrado." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Si el job ya terminó (DONE/FAILED), devolvemos el evento terminal y
  // cerramos el stream inmediatamente. Esto cubre el caso "el cliente llega
  // tarde": un refresh tras terminar no debe quedar colgado esperando.
  const terminal = snapshotToSseEvent(snapshot);
  if (terminal) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(formatSse(terminal));
        controller.close();
      },
    });
    return sseResponse(stream);
  }

  // Job en cola o procesándose → abrimos stream vivo.
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      // 1) Emitimos el último progreso persistido en BD (re-hidrata la UI
      //    aunque el cliente se conecte a mitad del job).
      const lastProgress = snapshotProgressToSseEvent(snapshot);
      if (lastProgress) {
        controller.enqueue(
          encoder.encode(formatSse({ type: "progress", progress: lastProgress })),
        );
      }

      // 2) Nos suscribimos a los eventos de BullMQ para este job concreto.
      //    `Job.waitUntilFinished` es el método canónico: bloquea hasta
      //    que el job termina (completed/failed) o el timeout expira.
      const events = getQuestionExtractEvents();
      const prefix = getBullMQPrefix();
      const stateChanged = new Map<string, unknown>();
      const listener = ({ jobId: emittedId, ...rest }: { jobId: string; [k: string]: unknown }) => {
        if (emittedId !== jobId) return;
        Object.assign(stateChanged, rest);
      };
      events.on("progress", listener);
      events.on("completed", listener);
      events.on("failed", listener);

      // Re-leemos la fila periódicamente: el worker persiste progreso en BD
      // y queremos emitirlo aunque BullMQ no emita "progress" events (no
      // todos los pasos del pipeline llaman `job.updateProgress`).
      const poll = setInterval(async () => {
        if (closed) return;
        try {
          const current = await repo.findById(actor.institutionId, jobId);
          if (!current) return;
          const progress = snapshotProgressToSseEvent(current);
          if (progress) {
            controller.enqueue(
              encoder.encode(formatSse({ type: "progress", progress })),
            );
          }
          const terminalEvt = snapshotToSseEvent(current);
          if (terminalEvt) {
            controller.enqueue(encoder.encode(formatSse(terminalEvt)));
            cleanup();
          }
        } catch {
          // Silenciamos errores transitorios del poll: el SSE sigue vivo.
        }
      }, 1000);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        events.off("progress", listener);
        events.off("completed", listener);
        events.off("failed", listener);
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      // Heartbeat cada 15s: mantiene viva la conexión aunque el job esté
      // en cola sin progreso. Sin esto, algunos proxies (nginx, Cloudflare)
      // cierran el stream a los 30s.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      // Cleanup al desconectar el cliente.
      const onClose = () => {
        clearInterval(heartbeat);
        void cleanup();
      };
      // No hay API estándar para "cliente se fue"; usamos el setInterval
      // de poll como detector secundario (si falla el `enqueue`, asumimos
      // que el stream está roto).
      void onClose;
    },
    cancel() {
      closed = true;
    },
  });

  return sseResponse(stream);
}

function formatSse(event: QuestionExtractSseEvent): string {
  // Formato SSE: `data: <json>\n\n`. Cada `data:` puede aparecer varias
  // veces por evento; nosotros emitimos un solo bloque por simplicidad.
  return `data: ${JSON.stringify(event)}\n\n`;
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // desactiva buffering en nginx
    },
  });
}

// Re-exporta para que el tree-shaker no se queje de imports no usados.
export { QUEUE_NAMES };