/**
 * Llamada del worker al omr-service (`POST /analyze`).
 *
 * Caso que lo motiva (sep 2026): una hoja en producción falló con
 * PROCESSING_ERROR a los 60 s exactos: 30 s de espera + 1 reintento de otros
 * 30 s, y el log solo decía "OMR detection failed". Ahora:
 *   - el tiempo de espera se configura (OMR_TIMEOUT_MS, 90 s por defecto);
 *   - un tiempo agotado NO se reintenta: el análisis sigue corriendo en el
 *     servicio y reintentar solo le apila otra hoja igual de lenta;
 *   - solo se reintenta un fallo de red (servicio reiniciando);
 *   - el error dice qué pasó.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpOmrDetector } from "@/modules/scanning/infrastructure/http-omr-detector";

const IMAGEN = Buffer.from("png");
const OK = { thr: 0.5, questions: [{ n: 1, ans: "A", fills: [], crop: "" }] };

function respuesta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** fetch que nunca responde, pero que rechaza como el real cuando se aborta. */
function fetchQueNoResponde() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("This operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpOmrDetector", () => {
  it("devuelve la hoja detectada", async () => {
    const fetchMock = vi.fn(async () => respuesta(OK));
    vi.stubGlobal("fetch", fetchMock);
    const r = await new HttpOmrDetector("http://omr:8000", 1_000).analyze(IMAGEN);
    expect(r.questions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un tiempo agotado no se reintenta y el error lo dice", async () => {
    const fetchMock = fetchQueNoResponde();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpOmrDetector("http://omr:8000", 30).analyze(IMAGEN)).rejects.toThrow(
      /no respondió en 0 s \(tiempo de espera agotado\)/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("el mensaje muestra el tiempo configurado en segundos", async () => {
    vi.stubGlobal("fetch", fetchQueNoResponde());
    vi.useFakeTimers();
    try {
      const p = new HttpOmrDetector("http://omr:8000", 90_000).analyze(IMAGEN);
      const verificado = expect(p).rejects.toThrow(/no respondió en 90 s/);
      await vi.advanceTimersByTimeAsync(90_000);
      await verificado;
    } finally {
      vi.useRealTimers();
    }
  });

  it("un fallo de red se reintenta una vez", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }))
      .mockResolvedValueOnce(respuesta(OK));
    vi.stubGlobal("fetch", fetchMock);
    const r = await new HttpOmrDetector("http://omr:8000", 1_000).analyze(IMAGEN);
    expect(r.questions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("si la red sigue caída, el error incluye la causa", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpOmrDetector("http://omr:8000", 1_000).analyze(IMAGEN)).rejects.toThrow(
      /fetch failed \(ECONNREFUSED\)/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un error del motor (422, hoja ilegible) no se reintenta", async () => {
    const fetchMock = vi.fn(async () => respuesta({ error: "No se detectaron burbujas" }, 422));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpOmrDetector("http://omr:8000", 1_000).analyze(IMAGEN)).rejects.toThrow(
      /omr-service: No se detectaron burbujas/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
