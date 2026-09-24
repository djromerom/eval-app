import type { OmrDetector, DetectedSheet, DetectedQuestion } from "../domain/omr-detector";

/**
 * Implementación de `OmrDetector` que delega en el microservicio Python
 * (`omr-service`, FastAPI) por HTTP sobre loopback. Es el único punto del
 * módulo scanning que habla con el servicio de visión.
 *
 * El servicio solo escucha en 127.0.0.1 (nunca expuesto públicamente); el
 * tenant-check y toda la lógica de negocio siguen en el lado TS.
 */
export class HttpOmrDetector implements OmrDetector {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 30_000,
    private readonly retries = 1,
  ) {}

  async analyze(image: Buffer, opts?: { letters?: string }): Promise<DetectedSheet> {
    const letters = opts?.letters ?? "ABCDEFGH";
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const form = new FormData();
        // El nombre del archivo solo aporta el sufijo para el motor.
        form.append("file", new Blob([new Uint8Array(image)]), "scan.png");
        form.append("letters", letters);

        const res = await fetch(`${this.baseUrl}/analyze`, {
          method: "POST",
          body: form,
          signal: controller.signal,
        });

        const body = (await res.json()) as
          | { thr: number; questions: DetectedQuestion[]; idCrop?: string; idOcr?: string | null }
          | { error: string };

        if (!res.ok || "error" in body) {
          const msg = "error" in body ? body.error : `HTTP ${res.status}`;
          throw new Error(`omr-service: ${msg}`);
        }
        if (!Array.isArray(body.questions)) {
          throw new Error("omr-service: respuesta sin 'questions'");
        }
        return body as DetectedSheet;
      } catch (e) {
        lastError = e;
        // Reintenta salvo en el último intento.
        if (attempt === this.retries) break;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(
      `No se pudo analizar la hoja con omr-service (${this.baseUrl}): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
