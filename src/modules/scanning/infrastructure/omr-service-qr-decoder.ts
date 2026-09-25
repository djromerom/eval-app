import { logger } from "@/shared/infrastructure/logger";
import type { QrDecoder } from "../domain/answer-sheet";

const log = logger.child({ component: "omr-service-qr" });

/**
 * `QrDecoder` que delega en el microservicio Python (`omr-service`, `POST /qr`).
 *
 * Por qué existe: `sharpQrDecoder` decodifica con `qr/decode.js` sobre recortes
 * reescalados, y sobre escaneos degradados falla en una fracción de las hojas
 * (a ~2.6 px por módulo el decodificador integrado es marginal). El servicio
 * usa el decodificador WeChat de opencv-contrib, que sobre las hojas de prueba
 * leyó 5/5 donde el camino anterior leía 3/5.
 *
 * Va como SEGUNDO eslabón, no como reemplazo: `sharpQrDecoder` es local, no
 * cruza la red y además reporta los finder patterns. Este solo entra cuando
 * aquel devuelve `null`.
 *
 * No aporta `points`: el servicio devuelve la bbox del bloque, no los finder
 * patterns, y aproximarlos sería peor que omitirlos — la interfaz los declara
 * opcionales y el registro cae a detección de rejilla sin ellos.
 */
export class OmrServiceQrDecoder implements QrDecoder {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async decode(buffer: Buffer): Promise<{ text: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      // El nombre del archivo solo aporta el sufijo para el motor.
      form.append("file", new Blob([new Uint8Array(buffer)]), "scan.png");

      const res = await fetch(`${this.baseUrl}/qr`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { found?: boolean; text?: string } | { error: string };
      if ("error" in body || !body.found || !body.text) return null;

      // `text` es el contenido crudo impreso: la firma HMAC se verifica sobre
      // él (`canonicalJson` lo reordena, pero parte de este string).
      return { text: body.text };
    } catch (e) {
      // Un fallback que tumba el flujo es peor que no tener fallback: si el
      // servicio no responde, esto se comporta como "no pude leer el QR" y el
      // use case sigue su camino normal a REVIEW. Pero se registra: si no, un
      // omr-service lento hace que hojas con QR bueno se traten como
      // ilegibles sin ninguna pista en los logs.
      const agotado = e instanceof Error && e.name === "AbortError";
      log.warn(
        {
          baseUrl: this.baseUrl,
          motivo: agotado
            ? `no respondió en ${Math.round(this.timeoutMs / 1000)} s`
            : e instanceof Error
              ? e.message
              : String(e),
        },
        "omr-service /qr falló; se trata como QR no leído",
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Encadena decoders y devuelve el resultado del primero que lea algo.
 *  Mantiene a `ProcessAnswerSheet` ignorante de que hay más de un decoder:
 *  sigue viendo un único puerto `QrDecoder`.
 *
 *  Si un decoder lanza, la cadena sigue con el siguiente — que reviente el
 *  primero no es razón para no intentar el fallback. Pero si NINGUNO lee y
 *  hubo una excepción, se relanza la primera: así un bug real en un decoder
 *  no queda disfrazado de "esta hoja no tenía QR legible", que es un
 *  diagnóstico muy distinto para quien mire el lote en REVIEW. */
export function chainQrDecoders(...decoders: QrDecoder[]): QrDecoder {
  return {
    async decode(buffer: Buffer) {
      let firstError: unknown;
      for (const decoder of decoders) {
        try {
          const result = await decoder.decode(buffer);
          if (result) return result;
        } catch (e) {
          if (firstError === undefined) firstError = e;
        }
      }
      if (firstError !== undefined) throw firstError;
      return null;
    },
  };
}
