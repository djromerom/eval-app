import { z } from "zod";

/**
 * Contenido del QR de cada hoja de respuestas (REQUERIMIENTOS_v2.md §11).
 * Firmado con HMAC-SHA256 (clave derivada por institución) para evitar adulteración.
 *
 * Desde Sprint 2 del módulo compendios, una hoja puede pertenecer a una
 * evaluación individual (legacy) o a un bundle (compendio multi-evaluación).
 * El invariante es XOR: exactamente uno de `eval` o `bundle` debe estar
 * presente. Validamos esto con `.refine()` abajo; el tipo TS lo expresa
 * con dos variantes discriminadas por la presencia del campo.
 */
export const qrPayloadBaseSchema = z.object({
  inst: z.string().min(1), // código de institución
  student: z.string().min(1), // código estudiantil
  sheet: z.string().uuid(), // id de la hoja
  ts: z.number().int(), // timestamp de emisión (anti-replay)
});

/** Hoja de una evaluación individual (legacy + caso N=1 antes de Sprint 2). */
export const qrPayloadEvaluationSchema = qrPayloadBaseSchema.extend({
  eval: z.string().uuid(),
  bundle: z.undefined().optional(),
});

/** Hoja de un compendio (multi-evaluación). */
export const qrPayloadBundleSchema = qrPayloadBaseSchema.extend({
  bundle: z.string().uuid(),
  eval: z.undefined().optional(),
});

export const qrPayloadSchema = z
  .union([qrPayloadEvaluationSchema, qrPayloadBundleSchema])
  .refine((v) => Boolean(v.eval) !== Boolean(v.bundle), {
    message: "QR payload debe tener exactamente uno: eval o bundle",
  });

export type QrPayload = z.infer<typeof qrPayloadSchema>;

export const signedQrSchema = z
  .object({
    inst: z.string().min(1),
    student: z.string().min(1),
    sheet: z.string().uuid(),
    ts: z.number().int(),
    eval: z.string().uuid().optional(),
    bundle: z.string().uuid().optional(),
    sig: z.string().length(64),
  })
  .refine((v) => Boolean(v.eval) !== Boolean(v.bundle), {
    message: "QR payload debe tener exactamente uno: eval o bundle",
  });

export type SignedQrContent = z.infer<typeof signedQrSchema>;
