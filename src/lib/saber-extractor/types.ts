import { z } from "zod";

/**
 * Esquemas de dominio.
 *
 * Nota importante sobre el diseño:
 *  - La PASADA DE EXTRACCIÓN produce estructura (contextos, enunciados, opciones,
 *    imágenes, tablas) pero NO la respuesta correcta, porque el PDF no trae clave.
 *  - La PASADA DE RESOLUCIÓN calcula `correctAnswer` razonando cada pregunta.
 *  - El ENSAMBLADO final produce el JSON exacto que pediste.
 */

/* ----------------------------- Opciones ----------------------------- */

export const OptionSchema = z.object({
  key: z.string().min(1),
  text: z.string(),
});
export type Option = z.infer<typeof OptionSchema>;

/* ----------------------------- Contextos ---------------------------- */

export const ContextSchema = z.object({
  /** Título del contexto o null si no lo tiene. */
  title: z.string().nullable(),
  /** Texto completo del contexto (incluye [TABLA:...] e [IMAGEN N] si aplica). */
  text: z.string(),
});
export type Context = z.infer<typeof ContextSchema>;

/* --------------------- Pregunta cruda (extracción) ------------------ */

/**
 * Lo que devuelve la pasada de extracción. Incluye `number` (para deduplicar
 * al fusionar chunks) y NO incluye `correctAnswer`.
 */
export const ExtractedQuestionSchema = z.object({
  number: z.number().int().positive(),
  contextTitle: z.string().nullable(),
  text: z.string().min(1),
  options: z.array(OptionSchema).min(2),
  competency: z.string().nullable().default(null),
  evidence: z.string().nullable().default(null),
  imagePlaceholder: z.string().nullable().default(null),
});
export type ExtractedQuestion = z.infer<typeof ExtractedQuestionSchema>;

/* ------------------------------ Figuras ----------------------------- */

/**
 * Caja normalizada [x0, y0, x1, y1] en el rango 0..1 respecto de la página,
 * con el origen en la esquina SUPERIOR IZQUIERDA.
 */
export const BBoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type BBox = z.infer<typeof BBoxSchema>;

/**
 * Figura tal como la reporta el modelo: su `ref` y su `page` son LOCALES al
 * chunk (cada chunk es una llamada independiente y reinicia la numeración).
 * `globalizeFigures` las convierte en ids únicos y páginas absolutas.
 */
export const ExtractedFigureSchema = z.object({
  ref: z.number().int().positive(),
  /** Página dentro del chunk (1 = primera página recibida). */
  page: z.number().int().positive(),
  bbox: BBoxSchema,
  caption: z.string().nullable().default(null),
});
export type ExtractedFigure = z.infer<typeof ExtractedFigureSchema>;

/** Figura ya resuelta: id único, página absoluta del PDF y archivo en disco. */
export const FigureSchema = z.object({
  /** Id único y estable, p. ej. "p04-fig1". */
  id: z.string().min(1),
  /** Página absoluta del PDF (1-based). */
  page: z.number().int().positive(),
  bbox: BBoxSchema,
  caption: z.string().nullable(),
  /** Ruta del archivo, relativa al JSON de salida. null si no se materializó. */
  file: z.string().nullable().default(null),
  /**
   * Cómo se obtuvo:
   *  - "embedded": copiada tal cual del PDF (exacta).
   *  - "detected": recorte con la caja del detector de layout (ajustada).
   *  - "crop": recorte con el bbox estimado por el LLM (holgado).
   */
  source: z.enum(["embedded", "detected", "crop", "pending"]).default("pending"),
  /**
   * Resultado del pase de verificación visual:
   *  - "ok": el modelo confirmó que el recorte contiene la figura completa.
   *  - "corrected": salió mal y se volvió a recortar con el bbox corregido.
   *  - "flagged": el modelo lo marcó mal pero no supo dar una caja mejor;
   *    el recorte original se conserva y conviene revisarlo a mano.
   *  - "unchecked": no se verificó (figura incrustada, o verificación apagada).
   */
  verified: z.enum(["ok", "corrected", "flagged", "unchecked"]).default("unchecked"),
});
export type Figure = z.infer<typeof FigureSchema>;

export const ExtractionChunkSchema = z.object({
  contexts: z.array(ContextSchema),
  questions: z.array(ExtractedQuestionSchema),
  figures: z.array(ExtractedFigureSchema).default([]),
});
export type ExtractionChunk = z.infer<typeof ExtractionChunkSchema>;

/* ------------------------- Respuesta resuelta ----------------------- */

export const ANSWER_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export const AnswerKeySchema = z.enum(ANSWER_KEYS);
export type AnswerKey = z.infer<typeof AnswerKeySchema>;

export const SolvedAnswerSchema = z.object({
  number: z.number().int().positive(),
  answer: AnswerKeySchema,
  /** Confianza declarada por el modelo. */
  confidence: z.enum(["alta", "media", "baja"]).default("media"),
  /** Justificación breve (auditable). */
  rationale: z.string().default(""),
});
export type SolvedAnswer = z.infer<typeof SolvedAnswerSchema>;

/* ---------------------- Salida final (tu esquema) ------------------- */

/** Pregunta con el formato EXACTO que pediste. */
export const FinalQuestionSchema = z.object({
  contextTitle: z.string().nullable(),
  contextText: z.string(),
  text: z.string(),
  options: z.array(OptionSchema).min(2),
  correctAnswer: AnswerKeySchema,
  competency: z.string().nullable(),
  evidence: z.string().nullable(),
  imagePlaceholder: z.string().nullable(),
  /** Id de la figura referenciada. Solo presente si se extrajeron imágenes. */
  imageId: z.string().nullable().optional(),
  /** Ruta del archivo de la figura, relativa a este JSON. */
  imageFile: z.string().nullable().optional(),
});
export type FinalQuestion = z.infer<typeof FinalQuestionSchema>;

/** Salida final del pipeline (coincide con el JSON solicitado). */
export const FinalOutputSchema = z.object({
  contexts: z.array(ContextSchema),
  questions: z.array(FinalQuestionSchema),
  /** Catálogo de figuras. Solo presente si se extrajeron imágenes. */
  images: z.array(FigureSchema).optional(),
});
export type FinalOutput = z.infer<typeof FinalOutputSchema>;

/**
 * Variante con auditoría: agrega confianza y justificación por pregunta.
 * No rompe el esquema base; solo añade campos opcionales.
 */
export const AuditedQuestionSchema = FinalQuestionSchema.extend({
  number: z.number().int().positive(),
  answerConfidence: z.enum(["alta", "media", "baja"]),
  answerRationale: z.string(),
});
export type AuditedQuestion = z.infer<typeof AuditedQuestionSchema>;
