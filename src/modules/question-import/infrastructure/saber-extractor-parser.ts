/**
 * Adapter de `extractExam()` al contrato `ParseResult` del
 * módulo de import. Encapsula:
 *
 *   1. Escritura del PDF recibido como Buffer a un tempdir (el motor
 *      exige `pdfPath`, no buffer).
 *   2. Selección del provider IA: Anthropic si hay `ANTHROPIC_API_KEY`,
 *      si no MiniMax con las `MINIMAX_*` ya conocidas.
 *   3. Subida de cada figura recortada al storage institucional vía la
 *      misma `UploadImageFn` que usa el parser DOCX (mismo `sharp`,
 *      misma ruta `evaluations/{institutionId}/...`).
 *   4. Mapeo `AuditedQuestion` → `ParsedQuestion`, hidratando `contextText`
 *      desde `output.contexts` cuando la pregunta solo traía `contextTitle`.
 *   5. Limpieza garantizada del tempdir en `finally` (falla o éxito).
 *
 * Se mantiene PURO de dependencias de BullMQ / Prisma: recibe el buffer y
 * la función de upload por parámetro. Eso lo hace 100 % testeable con
 * `vi.mock("@/lib/saber-extractor", ...)` sin tocar Redis ni la BD.
 *
 * NOTA de arquitectura: el motor vive en `src/lib/saber-extractor/` y NO
 * es una dep npm externa — fue codeado in-house y embebido en eval-app
 * para evitar dependencia circular con un repo GH separado (que rompía
 * CI/CD por temas de cross-repo auth). Si en algún momento se quiere
 * extraer de nuevo a un paquete independiente, el límite limpio es esta
 * carpeta.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  extractExam,
  figureIdsInText,
  layoutAvailable,
  type AuditedQuestion,
  type Figure,
} from "@/lib/saber-extractor";
import type { UploadImageFn } from "../infrastructure/docx-parser";
import type { AnswerConfidence, ParseResult, ParsedQuestion } from "../domain/parsed-question";
import type { QuestionExtractProgress } from "../domain/question-import-queue";
import { ANSWER_KEYS_ORDER } from "@/modules/evaluations/domain/evaluation";

const TmpDirPrefix = "saber-";

export interface ParseQuestionsFromPdfInput {
  buffer: Buffer;
  institutionId: string;
  uploadImage: UploadImageFn;
  /** Callback opcional que el worker usa para reportar progreso a BullMQ
   *  (y de ahí al SSE). La UI no se acopla a saber-extractor. */
  onProgress?: (ev: QuestionExtractProgress) => void;
}

interface ProviderSelection {
  provider: "anthropic" | "minimax";
  extractModel?: string;
  solveModel?: string;
}

/**
 * Elige el provider a partir de env vars. Anthropic gana si está la key —
 * es lo que el plan aprobó (Claude Sonnet/Opus con thinking para "solve").
 * Si no, cae a MiniMax con la config ya en uso en el parser legacy.
 *
 * Lanza un error claro si NINGUNA provider está configurada: sin IA no
 * tiene sentido gastar la llamada.
 */
function pickProvider(): ProviderSelection {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      extractModel: process.env.SABER_EXTRACT_MODEL,
      solveModel: process.env.SABER_SOLVE_MODEL,
    };
  }
  if (process.env.MINIMAX_API_KEY) {
    return {
      provider: "minimax",
      extractModel: process.env.MINIMAX_MODEL,
    };
  }
  throw new Error("Importación con IA no configurada: define ANTHROPIC_API_KEY o MINIMAX_API_KEY.");
}

/**
 * Normaliza un buffer PNG/JPEG cualquiera a JPEG ≤1200×1200 con la misma
 * pipeline que usa `makeUploadImageForInstitution` para las imágenes DOCX.
 * Mantener una sola rutina de normalización evita que el LMS termine con
 * figuras en formatos distintos según el origen.
 */
async function normalizeToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

function toBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/** Sube una figura recortada por saber-extractor al storage institucional. */
async function uploadFigure(
  fig: Figure,
  imagesDir: string,
  uploadImage: UploadImageFn,
  institutionId: string,
): Promise<string | null> {
  if (!fig.file) return null;
  const path = join(imagesDir, fig.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    return null;
  }
  let normalized: Buffer;
  try {
    normalized = await normalizeToJpeg(bytes);
  } catch {
    return null;
  }
  const contentType = "image/jpeg";
  const res = await uploadImage({
    institutionId,
    contentType,
    base64: toBase64(normalized),
  });
  if ("error" in res) return null;
  return res.url;
}

/**
 * Mapea `AuditedQuestion` → `ParsedQuestion`. `contextText` se hidrata
 * desde `contextsByTitle` cuando la pregunta solo referencia por título
 * (saber-extractor suele repetir el texto en cada pregunta; si está, lo
 * respeta; si no, lo trae del contexto compartido).
 */
function mapAuditedQuestion(
  q: AuditedQuestion,
  contextsByTitle: Map<string, string>,
  figIdToUrl: Map<string, string>,
): ParsedQuestion {
  const options = q.options
    .filter((o) => ANSWER_KEYS_ORDER.includes(o.key as never))
    .map((o) => ({
      key: o.key as ParsedQuestion["options"][number]["key"],
      text: (o.text ?? "").trim(),
    }));

  const imageId = q.imageId ?? null;
  const imageUrl = imageId ? (figIdToUrl.get(imageId) ?? null) : null;

  const contextText =
    q.contextText?.trim() ||
    (q.contextTitle ? (contextsByTitle.get(q.contextTitle) ?? null) : null);

  // Hidratamos `contextImages` con todas las figuras referenciadas DENTRO
  // del `contextText` (no solo la primera). `figureIdsInText` ya filtra
  // por ids globalizados (`/^p\d+-fig\d+$/`) y deduplica, así que el
  // mapa solo trae entries con URLs reales (las que se subieron bien)
  // y nunca trae IDs basura del LLM.
  const contextImages: Record<string, string> = {};
  if (contextText) {
    for (const id of figureIdsInText(contextText)) {
      const url = figIdToUrl.get(id);
      if (url) contextImages[id] = url;
    }
  }

  const answerConfidence = q.answerConfidence as AnswerConfidence | undefined;

  return {
    sourceNumber: q.number,
    text: q.text,
    options,
    correctAnswer: q.correctAnswer,
    competency: q.competency ?? null,
    evidence: q.evidence ?? null,
    contextTitle: q.contextTitle ?? null,
    contextText,
    contextImages,
    image: imageUrl ? { url: imageUrl } : null,
    warnings: [],
    ...(answerConfidence ? { answerConfidence } : {}),
    ...(q.answerRationale ? { answerRationale: q.answerRationale } : {}),
  };
}

/**
 * Decide si se le pide al motor que use el detector de layout (DocLayout-YOLO)
 * para afinar los bboxes de las figuras. Layout es **ON-por-defecto**: probeamos
 * el detector Python una vez al primer job (`layoutAvailable` corre
 * `detect_layout.py --check`, que descarga el modelo la primera vez), y
 * cacheamos el resultado en memoria para no pagar el probe por cada extracción.
 *
 * - Si el detector responde → `true` y logueamos INFO una vez.
 * - Si no responde (venv no instalado, onnxruntime faltante, sin red para
 *   descargar el modelo) → `false` y logueamos INFO con el motivo. Sin WARN
 *   porque el fallback es el comportamiento histórico; no es un error.
 * - Si querés forzar el camino "bbox del LLM" (e.g. depuración), exportá
 *   `SABER_EXTRACT_LAYOUT_ENABLED=0` antes de arrancar el worker.
 *
 * ¿Por qué auto-on y no flag-gated? El flag original obligaba al operador a
 * recordar configurarlo, mientras que el sidecar Python ya viene en el árbol
 * del paquete saber-extractor: con `pip install` único, todas las figuras
 * salen ajustadas. Quitar el flag elimina un "ya lo configuraré" que se
 * traducía en crops sucios en producción.
 *
 * Cachear el resultado es válido porque el worker es un proceso PM2 estable:
 * si cambian las deps Python (instalás onnxruntime), basta reiniciar el
 * worker para que el probe se vuelva a correr.
 */
let layoutCheckPromise: Promise<boolean> | null = null;

async function resolveLayoutEnabled(): Promise<boolean> {
  if (process.env.SABER_EXTRACT_LAYOUT_ENABLED === "0") {
    console.info("[saber-extractor-parser] layout desactivado por SABER_EXTRACT_LAYOUT_ENABLED=0.");
    return false;
  }
  if (!layoutCheckPromise) {
    layoutCheckPromise = (async () => {
      const check = await layoutAvailable();
      if (check.ok) {
        console.info(
          "[saber-extractor-parser] layout detector activo: recortes ajustados con DocLayout-YOLO.",
        );
        return true;
      }
      console.info(
        `[saber-extractor-parser] layout no disponible (${check.reason}); usando bbox del LLM.`,
      );
      return false;
    })();
  }
  return layoutCheckPromise;
}

/**
 * Punto de entrada. Ejecuta el pipeline completo y devuelve `ParseResult`
 * con las preguntas listas para entrar a la pantalla de revisión.
 */
export async function parseQuestionsFromPdf(
  input: ParseQuestionsFromPdfInput,
): Promise<ParseResult> {
  const { buffer, institutionId, uploadImage, onProgress } = input;

  const tmpDir = join(tmpdir(), `${TmpDirPrefix}${Date.now()}-${process.pid}`);
  await mkdir(tmpDir, { recursive: true });
  const pdfPath = join(tmpDir, "input.pdf");
  const imagesDir = join(tmpDir, "figs");
  await mkdir(imagesDir, { recursive: true });

  try {
    await writeFile(pdfPath, buffer);

    // Layout: decidido ANTES de invocar el motor para no pasar la opción
    // cuando el detector Python no esté listo. `resolveLayoutEnabled` ya
    // loggea el motivo si la flag está ON pero el detector no responde,
    // así que aquí solo propagamos el booleano limpio.
    const layoutEnabled = await resolveLayoutEnabled();
    const sel = pickProvider();
    const result = await extractExam(pdfPath, {
      provider: { type: sel.provider },
      ...(sel.extractModel
        ? { models: { extractModel: sel.extractModel, solveModel: sel.solveModel ?? "" } }
        : {}),
      images: {
        dir: imagesDir,
        dpi: 200,
        layout: layoutEnabled,
        // `layoutDpi` no se setea: usamos el default del motor (150 DPI).
        // Subirlo mejora precisión en figuras pequeñas pero multiplica
        // el coste de inferencia (cuadrático en DPI). Reconfigurable
        // desde aquí si vemos recortes incompletos en escaneos.
      },
      parallelExtraction: false,
      onProgress: (ev) => {
        // Mapeo 1:1 del ProgressEvent de saber-extractor a nuestro subset.
        // Solo propagamos las fases que la UI pinta explícitamente; las
        // intermedias (images-verify, images-done) se descartan.
        switch (ev.phase) {
          case "split":
            onProgress?.({ phase: "split", totalPages: ev.totalPages, chunks: ev.chunks });
            return;
          case "extract":
            onProgress?.({ phase: "extract", chunk: ev.chunk, of: ev.of, pages: ev.pages });
            return;
          case "extract-done":
            onProgress?.({
              phase: "extract-done",
              questions: ev.questions,
              contexts: ev.contexts,
              missing: ev.missing,
            });
            return;
          case "solve":
            onProgress?.({ phase: "solve", solved: ev.solved, of: ev.of });
            return;
          case "images":
            onProgress?.({ phase: "images", done: ev.done, of: ev.of });
            return;
          case "assemble":
            onProgress?.({ phase: "assemble", questions: ev.questions });
            return;
          case "images-verify":
          case "images-done":
            return;
        }
      },
    });

    // Subimos figuras en una fase dedicada: el pipeline ya las escribió en
    // imagesDir; ahora las movemos al storage institucional y mapeamos id→url.
    onProgress?.({ phase: "uploading", figuresDone: 0, of: result.figures.length });
    const figIdToUrl = new Map<string, string>();
    let figuresDone = 0;
    for (const fig of result.figures) {
      const url = await uploadFigure(fig, imagesDir, uploadImage, institutionId);
      if (url) figIdToUrl.set(fig.id, url);
      figuresDone++;
      onProgress?.({ phase: "uploading", figuresDone, of: result.figures.length });
    }

    // Hidratamos contextos por título para resolver preguntas que solo
    // referencian por nombre (saber-extractor a veces emite contextText=null
    // y solo contextTitle=...).
    const contextsByTitle = new Map<string, string>();
    for (const ctx of result.output.contexts) {
      if (ctx.title) contextsByTitle.set(ctx.title, ctx.text);
    }

    const questions = result.audited.map((q) => mapAuditedQuestion(q, contextsByTitle, figIdToUrl));

    const warnings: string[] = [];
    if (result.missingNumbers.length > 0) {
      warnings.push(
        `Números ausentes en la numeración: ${result.missingNumbers.join(", ")}. ` +
          `Revisa que el PDF no haya perdido páginas al exportar.`,
      );
    }
    const failedFigures = result.figures.filter((f) => !f.file).length;
    if (failedFigures > 0) {
      warnings.push(
        `${failedFigures} figura(s) no se pudieron recortar; las preguntas asociadas quedaron sin imagen.`,
      );
    }

    return { questions, warnings };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
