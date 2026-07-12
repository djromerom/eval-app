import { z } from "zod";

/**
 * Contenido del QR de cada hoja de respuestas (REQUERIMIENTOS_v2.md §11).
 * Firmado con HMAC-SHA256 (clave derivada por institución) para evitar adulteración.
 */
export const qrPayloadSchema = z.object({
  inst: z.string().min(1), // código de institución
  eval: z.string().uuid(), // id de evaluación
  student: z.string().min(1), // código estudiantil
  sheet: z.string().uuid(), // id de la hoja
  ts: z.number().int(), // timestamp de emisión (anti-replay)
});

export type QrPayload = z.infer<typeof qrPayloadSchema>;

export const signedQrSchema = qrPayloadSchema.extend({
  sig: z.string().length(64), // HMAC-SHA256 hex
});

export type SignedQrContent = z.infer<typeof signedQrSchema>;
