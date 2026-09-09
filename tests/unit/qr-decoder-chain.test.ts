/**
 * Tests de la cadena de decoders QR (sep 2026).
 * =============================================
 *
 * `sharpQrDecoder` no lee el QR de los escaneos degradados del lote MDLM
 * (falló en las 6 hojas de prueba), así que el flujo cae al decodificador
 * WeChat del omr-service. Estos tests fijan la semántica de esa cadena; el
 * decoder remoto en sí se prueba contra el servicio, no acá.
 */
import { describe, expect, it, vi } from "vitest";
import { chainQrDecoders } from "@/modules/scanning/infrastructure/omr-service-qr-decoder";
import type { QrDecoder } from "@/modules/scanning/domain/answer-sheet";

const buf = Buffer.from("scan");
const reads = (text: string): QrDecoder => ({ decode: vi.fn(async () => ({ text })) });
const fails = (): QrDecoder => ({ decode: vi.fn(async () => null) });
const throws = (msg: string): QrDecoder => ({
  decode: vi.fn(async () => {
    throw new Error(msg);
  }),
});

describe("chainQrDecoders", () => {
  it("devuelve el primero que lee y no consulta a los siguientes", async () => {
    const segundo = reads("B");
    const r = await chainQrDecoders(reads("A"), segundo).decode(buf);
    expect(r).toEqual({ text: "A" });
    expect(segundo.decode).not.toHaveBeenCalled();
  });

  it("cae al siguiente cuando el primero no lee", async () => {
    const r = await chainQrDecoders(fails(), reads("fallback")).decode(buf);
    expect(r).toEqual({ text: "fallback" });
  });

  it("null si ninguno lee (sin excepciones de por medio)", async () => {
    await expect(chainQrDecoders(fails(), fails()).decode(buf)).resolves.toBeNull();
  });

  it("sigue al fallback aunque el primero lance", async () => {
    const r = await chainQrDecoders(throws("boom"), reads("rescatado")).decode(buf);
    expect(r).toEqual({ text: "rescatado" });
  });

  it("relanza la primera excepción si ninguno logra leer", async () => {
    // Un bug real en un decoder no debe disfrazarse de 'hoja sin QR legible':
    // son dos diagnósticos distintos para quien revisa el lote.
    await expect(chainQrDecoders(throws("boom"), fails()).decode(buf)).rejects.toThrow("boom");
  });

  it("sin decoders devuelve null", async () => {
    await expect(chainQrDecoders().decode(buf)).resolves.toBeNull();
  });
});
