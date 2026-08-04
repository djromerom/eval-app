import { createProvider, DEFAULT_MODELS, type ProviderConfig } from "./provider";
import { extractChunk } from "./extractor";
import {
  FigureRegistry,
  figureIdFromPlaceholder,
  figureIdsInText,
  globalizeFigures,
  materializeFigures,
} from "./figures";
import { findMissingNumbers, mergeChunks, type MergedExtraction } from "./merge";
import { getPageCount, loadPdfBytes, splitPdf, type ChunkOptions } from "./pdf";
import { solveAnswers, type SolveOptions } from "./solver";
import {
  type AuditedQuestion,
  type Context,
  type ExtractedQuestion,
  type Figure,
  type FinalOutput,
  type SolvedAnswer,
} from "./types";

export interface ImageOptions {
  /** Carpeta donde escribir los PNG de las figuras. */
  dir: string;
  /** Resolución de render para los recortes (def. 200). */
  dpi?: number;
  /** Prefijo de ruta a escribir en el JSON (def. el nombre de la carpeta). */
  jsonPrefix?: string;
  /**
   * Revisar cada recorte con el modelo y corregir los que salgan mal
   * (def. false). Cuesta una llamada por recorte y NO es fiable: rescata
   * recortes rotos, pero también puede estropear uno que estaba bien, y da
   * veredictos distintos entre corridas con la misma entrada. Actívalo para
   * rescatar figuras cortadas, revisando después el campo `verified`.
   */
  verify?: boolean;
  /** Modelo del pase de verificación (def. el de extracción). */
  verifyModel?: string;
  /**
   * Usar el detector de layout en Python para ajustar las cajas de las figuras
   * (def. false). Requiere el venv de `python/`; ver README.
   */
  layout?: boolean;
  /** Resolución de rasterizado para el detector (def. 150). */
  layoutDpi?: number;
}

export interface PipelineOptions {
  provider?: ProviderConfig;
  models?: Partial<{
    extractModel: string;
    solveModel: string;
    solveThinkingBudget: number;
  }>;
  chunking?: ChunkOptions;
  solve?: boolean;
  solveBatchSize?: number;
  hydrateContextText?: boolean;
  parallelExtraction?: boolean;
  /** Extraer las figuras a disco y referenciarlas en el JSON. */
  images?: ImageOptions;
  onProgress?: (ev: ProgressEvent) => void;
}

export type ProgressEvent =
  | { phase: "split"; totalPages: number; chunks: number }
  | { phase: "extract"; chunk: number; of: number; pages: number[] }
  | { phase: "extract-done"; questions: number; contexts: number; missing: number[] }
  | { phase: "solve"; solved: number; of: number }
  | { phase: "images"; done: number; of: number }
  | { phase: "images-verify"; done: number; of: number }
  | {
      phase: "images-done";
      total: number;
      embedded: number;
      detected: number;
      cropped: number;
      corrected: number;
      failed: number;
      warnings: string[];
    }
  | { phase: "assemble"; questions: number };

export interface PipelineResult {
  output: FinalOutput;
  audited: AuditedQuestion[];
  merged: MergedExtraction;
  answers: Map<number, SolvedAnswer>;
  missingNumbers: number[];
  figures: Figure[];
}

export async function extractExam(
  pdfPath: string,
  opts: PipelineOptions = {},
): Promise<PipelineResult> {
  const providerConfig: ProviderConfig = opts.provider ?? { type: "anthropic" };
  const defaults = DEFAULT_MODELS[providerConfig.type];
  const models = { ...defaults, ...opts.models };
  const client = createProvider(providerConfig);

  const emit = opts.onProgress ?? (() => {});

  const bytes = await loadPdfBytes(pdfPath);
  const totalPages = await getPageCount(bytes);
  const chunks = await splitPdf(bytes, opts.chunking);
  emit({ phase: "split", totalPages, chunks: chunks.length });

  const withFigures = opts.images !== undefined;

  const extractOne = async (i: number) => {
    const c = chunks[i]!;
    emit({ phase: "extract", chunk: i + 1, of: chunks.length, pages: c.pages });
    return extractChunk(client, c, { model: models.extractModel, withFigures });
  };

  const results = opts.parallelExtraction
    ? await Promise.all(chunks.map((_, i) => extractOne(i)))
    : await sequential(chunks.length, extractOne);

  // La numeración [IMAGEN N] del modelo es local a cada chunk, así que se
  // convierte a ids únicos ANTES de fusionar. Se recorren los chunks en orden
  // para que los ids sean deterministas incluso con extracción en paralelo.
  const registry = new FigureRegistry();
  if (withFigures) {
    for (const [i, res] of results.entries()) {
      globalizeFigures(registry, res.figures, res.questions, res.contexts, chunks[i]!.pages);
    }
  }

  const merged = mergeChunks(results);
  const missing = findMissingNumbers(merged.questions);
  emit({
    phase: "extract-done",
    questions: merged.questions.length,
    contexts: merged.contexts.length,
    missing,
  });

  let answers = new Map<number, SolvedAnswer>();
  if (opts.solve !== false) {
    const solveOpts: SolveOptions = {
      model: models.solveModel,
      batchSize: opts.solveBatchSize ?? 8,
      thinkingBudget: models.solveThinkingBudget,
    };
    answers = await solveAnswers(client, merged.questions, merged.contexts, solveOpts);
    emit({ phase: "solve", solved: answers.size, of: merged.questions.length });
  }

  let figures: Figure[] = [];
  if (opts.images) {
    figures = registry.all();
    const res = await materializeFigures(figures, {
      pdfPath,
      pdfBytes: bytes,
      outDir: opts.images.dir,
      ...(opts.images.dpi !== undefined ? { dpi: opts.images.dpi } : {}),
      ...(opts.images.layout
        ? {
            layout: {
              ...(opts.images.layoutDpi !== undefined ? { dpi: opts.images.layoutDpi } : {}),
            },
          }
        : {}),
      ...(opts.images.verify === true
        ? {
            verify: {
              client,
              model: opts.images.verifyModel ?? models.extractModel,
              onProgress: (done, of) => emit({ phase: "images-verify", done, of }),
            },
          }
        : {}),
      onProgress: (done, of) => emit({ phase: "images", done, of }),
    });
    const prefix = opts.images.jsonPrefix;
    if (prefix) {
      for (const f of figures) if (f.file) f.file = `${prefix}/${f.file}`;
    }
    emit({
      phase: "images-done",
      total: figures.length,
      embedded: res.embedded,
      detected: res.detected,
      cropped: res.cropped,
      corrected: res.corrected,
      failed: res.failed,
      warnings: res.warnings,
    });
  }

  const audited = assemble(
    merged,
    answers,
    opts.hydrateContextText ?? false,
    withFigures ? figures : null,
  );
  emit({ phase: "assemble", questions: audited.length });

  const output: FinalOutput = {
    contexts: merged.contexts,
    questions: audited.map(stripAudit),
    ...(withFigures ? { images: figures } : {}),
  };

  return { output, audited, merged, answers, missingNumbers: missing, figures };
}

async function sequential<T>(n: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(await fn(i));
  return out;
}

function assemble(
  merged: MergedExtraction,
  answers: Map<number, SolvedAnswer>,
  hydrate: boolean,
  figures: Figure[] | null,
): AuditedQuestion[] {
  const ctxByTitle = new Map<string, Context>();
  for (const c of merged.contexts) if (c.title) ctxByTitle.set(c.title, c);

  const figById = new Map<string, Figure>();
  for (const f of figures ?? []) figById.set(f.id, f);

  return merged.questions.map((q: ExtractedQuestion) => {
    const solved = answers.get(q.number);
    const answer = solved?.answer ?? fallbackAnswer(q);
    const contextText =
      hydrate && q.contextTitle ? (ctxByTitle.get(q.contextTitle)?.text ?? "") : "";
    const ctx = q.contextTitle ? ctxByTitle.get(q.contextTitle) : undefined;
    const imageId = resolveImageId(q, ctx, figures);
    return {
      number: q.number,
      contextTitle: q.contextTitle,
      contextText,
      text: q.text,
      options: q.options,
      correctAnswer: answer,
      competency: q.competency,
      evidence: q.evidence,
      imagePlaceholder: q.imagePlaceholder,
      ...(figures
        ? {
            imageId,
            imageFile: (imageId ? figById.get(imageId)?.file : null) ?? null,
          }
        : {}),
      answerConfidence: solved?.confidence ?? "baja",
      answerRationale: solved?.rationale ?? "Sin resolver.",
    };
  });
}

/**
 * Resuelve el id de la figura asociada a una pregunta en este orden de
 * preferencia:
 *
 *  1. `imagePlaceholder` que llenó el LLM (forma explícita, siempre gana).
 *  2. Primera figura referenciada dentro del contexto compartido (caso
 *     típico: lectura con figuras que varias preguntas aprovechan).
 *  3. Primera figura referenciada dentro del PROPIO texto de la pregunta.
 *     Este tercer fallback rescata el caso "pregunta con su propia
 *     figura" cuando el LLM olvidó llenar `imagePlaceholder` pero sí
 *     puso la referencia `[IMAGEN N]` en el `text`. Sin esto, las
 *     figuras dentro de preguntas individuales (sin contexto compartido)
 *     quedaban huérfanas: recortadas a disco pero sin vínculo a la
 *     pregunta que las usa.
 *
 * Después de `globalizeFigures` las referencias en `text` ya están en
 * formato global (`p04-fig1`), que es el que `figureIdsInText` acepta.
 *
 * Exportada para tests; el motor la invoca vía `assemble`.
 */
export function resolveImageId(
  question: ExtractedQuestion,
  context: Context | undefined,
  figures: Figure[] | null,
): string | null {
  if (!figures) return null;
  return (
    figureIdFromPlaceholder(question.imagePlaceholder) ??
    (context ? (figureIdsInText(context.text)[0] ?? null) : null) ??
    figureIdsInText(question.text)[0] ??
    null
  );
}

function fallbackAnswer(q: ExtractedQuestion): AuditedQuestion["correctAnswer"] {
  const first = q.options[0]?.key?.toUpperCase();
  const valid = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
  return (valid as readonly string[]).includes(first ?? "")
    ? (first as AuditedQuestion["correctAnswer"])
    : "A";
}

function stripAudit(q: AuditedQuestion): FinalOutput["questions"][number] {
  const { number: _n, answerConfidence: _c, answerRationale: _r, ...rest } = q;
  void _n;
  void _c;
  void _r;
  return rest;
}
