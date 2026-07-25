"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type {
  ParsedQuestion,
  ParsedQuestionProblem,
} from "@/modules/question-import/domain/parsed-question";
import { parseQuestionsCsv } from "@/modules/question-import/infrastructure/csv";
import { parseQuestionsDocx } from "@/modules/question-import/infrastructure/docx";
import { makeUploadImageForInstitution } from "@/modules/question-import/infrastructure/docx-upload";
import { loadAiConfig } from "@/shared/infrastructure/ai/config";
import { AiClient } from "@/shared/infrastructure/ai/client";
import {
  parseQuestionsWithAi,
  AI_PROMPT_SYSTEM,
} from "@/modules/question-import/infrastructure/ai-parser";
import {
  makeEnqueueQuestionImport,
  makeImportQuestions,
  makeQuestionsFromEvaluation,
} from "@/modules/question-import/infrastructure/container";

export interface CommitImportState {
  error?: string;
  imported?: number;
  problems?: ParsedQuestionProblem[];
  /** Mensajes no-fatales (cómo se reubicó el contexto compartido). */
  infos?: string[];
}

/**
 * Recibe la revisión del docente (qué preguntas, qué respuesta correcta) y
 * ejecuta el alta. Los índices vienen como cadenas separadas por coma porque
 * los formularios HTML no admiten arrays.
 */
export async function commitImportAction(
  _prev: CommitImportState | null,
  formData: FormData,
): Promise<CommitImportState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const destinationKind = String(formData.get("destinationKind") ?? "");
  const destinationId = String(formData.get("destinationId") ?? "").trim();
  const evaluationId = String(formData.get("evaluationId") ?? "").trim();
  const sectionId = String(formData.get("sectionId") ?? "").trim();
  const payloadRaw = String(formData.get("payload") ?? "");
  const correctionsRaw = String(formData.get("corrections") ?? "{}");

  if (!destinationKind || (destinationKind !== "evaluation" && destinationKind !== "bank")) {
    return { error: "Elige un destino para la importación." };
  }
  if (!evaluationId) {
    return { error: "Falta la formulación destino." };
  }
  // Destino formulación: el sectionId es OPCIONAL. Si el form lo trae, vamos
  // al camino legacy (anclar todo a una sección que el docente eligió). Si NO
  // lo trae (caso "importación con contextos → auto-crear secciones"), el
  // use case crea una sección por contexto y reparte las preguntas. Solo
  // rechazamos si el payload no tiene contextos Y el form no eligió sección,
  // porque entonces no hay ancla donde meter las preguntas — eso lo decide el
  // use case, no la action, para que el rechazo sea 100 % coherente con el
  // dominio.
  if (destinationKind === "bank" && !destinationId) {
    return { error: "Elige la asignatura del banco." };
  }

  let questions: ParsedQuestion[];
  try {
    questions = JSON.parse(payloadRaw) as ParsedQuestion[];
  } catch {
    return { error: "El formulario de revisión está corrupto. Recarga la página." };
  }

  let corrections: Record<number, AnswerKey> = {};
  try {
    corrections = JSON.parse(correctionsRaw) as Record<number, AnswerKey>;
  } catch {
    corrections = {};
  }

  // El docente decide cuáles entran y puede corregir la respuesta correcta
  // cuando el origen no la traía.
  const included = formData.getAll("include").map(String);
  const filtered = questions.filter((_, idx) => included.includes(String(idx)));
  const finalized = filtered.map((q, idx) => ({
    ...q,
    correctAnswer: q.correctAnswer ?? corrections[idx] ?? null,
  }));

  const destination =
    destinationKind === "evaluation"
      ? ({ kind: "evaluation", evaluationId, sectionId: sectionId || undefined } as const)
      : ({ kind: "bank", subjectId: destinationId } as const);

  const result = await makeImportQuestions().execute({
    actor,
    questions: finalized,
    destination,
  });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/import`);
  revalidatePath("/teacher/question-bank");
  revalidatePath("/teacher/evaluations");

  return {
    imported: result.value.imported,
    problems: result.value.problems,
    infos: result.value.infos,
  };
}

export interface LoadSourceState {
  questions: ParsedQuestion[];
  warnings: string[];
  error?: string;
}

/**
 * Carga las preguntas de la fuente seleccionada por el docente. Es el
 * único punto de entrada para todos los orígenes: hoy "formulación", "CSV"
 * y "DOCX"; mañana "PDF" cae aquí sin tocar la pantalla de revisión.
 */
export type LoadSourceInput =
  { kind: "evaluation"; evaluationId: string } | { kind: "csv"; content: string };

export async function loadSourceAction(input: LoadSourceInput): Promise<LoadSourceState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  if (input.kind === "evaluation") {
    const result = await makeQuestionsFromEvaluation().execute({
      actor,
      evaluationId: input.evaluationId,
    });
    if (!result.ok) return { questions: [], warnings: [], error: result.error.message };
    return result.value;
  }

  const parsed = parseQuestionsCsv(input.content);
  if (parsed.missing.length > 0) {
    return {
      questions: [],
      warnings: [],
      error: `Faltan columnas en el CSV: ${parsed.missing.join(", ")}.`,
    };
  }
  return parsed.result;
}

/**
 * Variante para DOCX: el archivo se sube como `multipart` por su tamaño
 * (un DOCX con 10 preguntas y 8 imágenes llega a ~3 MB). Lo dejamos en su
 * propia action porque no encaja con la firma plana de `loadSourceAction`
 * (que serializa el payload en JSON para evitar serializar el DOCX).
 */
export async function loadDocxSourceAction(formData: FormData): Promise<LoadSourceState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { questions: [], warnings: [], error: "Falta el archivo DOCX." };
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return { questions: [], warnings: [], error: "El archivo tiene que ser .docx." };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploadImage = makeUploadImageForInstitution();
  try {
    const parsed = await parseQuestionsDocx({
      buffer,
      institutionId: actor.institutionId,
      uploadImage,
    });
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer el DOCX.";
    return { questions: [], warnings: [], error: message };
  }
}

export interface EnqueueAiImportState {
  jobId?: string;
  error?: string;
}

/**
 * Sube el PDF al storage institucional y encola un job BullMQ para extraer
 * preguntas con `saber-extractor`. Devuelve `{ jobId }` para que la UI abra
 * el SSE `/api/import/{jobId}/stream` y siga el progreso en vivo.
 *
 * Antes este flujo corría sincrónicamente dentro del server action
 * (`loadAiSourceAction` legacy). Con varios docentes subiendo archivos a la
 * vez, el server Next se bloqueaba durante decenas de segundos; ahora la
 * cola reparte la carga entre N workers `worker-question-extract`.
 *
 * El cliente NO recibe las preguntas en el response: viajan por el SSE al
 * cerrar el job. Eso permite mostrar progreso real (no solo spinner).
 */
export async function enqueueAiImportAction(formData: FormData): Promise<EnqueueAiImportState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Falta el archivo." };
  }
  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isDocx = file.name.toLowerCase().endsWith(".docx");
  if (!isPdf && !isDocx) {
    return { error: "Solo se aceptan archivos PDF o DOCX." };
  }

  // Validación temprana de config IA: si no hay provider configurado, no
  // tiene sentido encolar (el worker fallaría al instante). Mejor fallar
  // rápido en la UI con mensaje accionable.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.MINIMAX_API_KEY) {
    return {
      error:
        "La importación con IA no está configurada (define ANTHROPIC_API_KEY o MINIMAX_API_KEY).",
    };
  }

  const evaluationIdRaw = formData.get("evaluationId");
  const evaluationId =
    typeof evaluationIdRaw === "string" && evaluationIdRaw.trim() ? evaluationIdRaw.trim() : null;

  const buffer = Buffer.from(await file.arrayBuffer());

  // Por ahora solo PDFs: DOCX sigue yendo por el camino legacy
  // (`loadDocxSourceAction` + mammoth). Migrar DOCX al worker es trivial
  // (cambiar el parser interno), pero fuera del scope de este PR.
  if (!isPdf) {
    return {
      error:
        "La importación IA con DOCX aún no está migrada al worker. Usa el flujo DOCX clásico o sube el archivo como PDF.",
    };
  }

  const result = await makeEnqueueQuestionImport().execute({
    actor,
    file: buffer,
    fileName: file.name,
    evaluationId,
  });
  if (!result.ok) return { error: result.error.message };

  return { jobId: result.value.jobId };
}

/**
 * Variante con IA: extrae preguntas de un PDF o DOCX usando Minimax.
 * El resultado pasa por la misma pantalla de revisión que CSV/DOCX.
 */
export async function loadAiSourceAction(formData: FormData): Promise<LoadSourceState> {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { questions: [], warnings: [], error: "Falta el archivo." };
  }

  const aiConfig = loadAiConfig();
  if (!aiConfig) {
    return {
      questions: [],
      warnings: [],
      error: "La importación con IA no está configurada (MINIMAX_API_KEY).",
    };
  }

  const isPdf = file.name.toLowerCase().endsWith(".pdf");
  const isDocx = file.name.toLowerCase().endsWith(".docx");
  if (!isPdf && !isDocx) {
    return { questions: [], warnings: [], error: "Solo se aceptan archivos PDF o DOCX." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Mapa: nº de imagen → URL real
  const imageMap: Record<number, string> = {};
  let docBuffer: Buffer = buffer;

  // Si es PDF, convertir a DOCX via Python/pdf2docx para extraer imágenes
  if (isPdf) {
    try {
      const { pdfToDocx } = await import("@/shared/infrastructure/pdf");
      docBuffer = Buffer.from(await pdfToDocx(buffer));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { questions: [], warnings: [], error: msg };
    }
  }

  // Procesar como DOCX: mammoth HTML + extraer imágenes
  const mammoth = await import("mammoth");
  const m = (mammoth.default ?? mammoth) as {
    convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const htmlResult = await m.convertToHtml({ buffer: docBuffer });
  const rawHtml = htmlResult.value;

  // Extraer data URIs de imágenes, subirlas y reemplazar por marcadores
  const uploadImage = (
    await import("@/modules/question-import/infrastructure/docx-upload")
  ).makeUploadImageForInstitution();
  let imgIndex = 0;
  const textWithMarkers = rawHtml.replace(
    /<img[^>]+src="data:image\/([a-z0-9+.-]+);base64,([^"]+)"[^>]*>/gi,
    (_match, contentType: string, base64: string) => {
      imgIndex++;
      const n = imgIndex;
      uploadImage({ institutionId: actor.institutionId, contentType, base64 }).then((res) => {
        if ("url" in res) imageMap[n] = res.url;
      });
      return `[IMAGEN ${n}]`;
    },
  );

  await new Promise((r) => setTimeout(r, 500));

  // Convertir HTML a texto plano (strip tags)
  let documentText = textWithMarkers
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!documentText) {
    const rawResult = await m.extractRawText({ buffer: docBuffer });
    documentText = rawResult.value;
  }

  if (!documentText.trim()) {
    return { questions: [], warnings: [], error: "No se pudo extraer texto del documento." };
  }

  // Limpiar posibles restos de imágenes no capturadas
  const cleanText = documentText
    .replace(/data:image\/[^;]+;base64,[^\s]+/g, "[IMAGEN]")
    .replace(/!\[.*?\]\(.*?\)/g, "[IMAGEN]")
    .slice(0, 50000);

  // Detección temprana: si tras la extracción el documento solo trae
  // placeholders de imágenes sin texto, no tiene sentido gastarse un request
  // a la IA — la respuesta sería un "no hay preguntas" genérico. Mejor
  // cortar con un mensaje accionable. Caso típico: PDF escaneado o DOCX
  // con imágenes y sin texto seleccionable, donde pdf2docx/mammoth
  // recuperan solo los markers.
  const strippedForCheck = cleanText.replace(/\[IMAGEN\s*\d+\]/g, "").trim();
  if (strippedForCheck.length < 50) {
    return {
      questions: [],
      warnings: [],
      error:
        "El documento no tiene texto extraíble — solo imágenes. Si es un PDF escaneado, aplicale OCR (Adobe Acrobat, OCRmyPDF, Google Drive) y vuelve a subirlo; si es un DOCX con imágenes, asegurate de que el texto esté como texto seleccionable, no como imágenes incrustadas.",
    };
  }

  const client = new AiClient(aiConfig);
  let aiResponse: string;
  try {
    aiResponse = await client.chat({
      system: AI_PROMPT_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Analiza el siguiente examen y extrae todas las preguntas con su contexto compartido:\n\n${cleanText}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 65536,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    if (/image|model does not support/i.test(message) && message.length < 200) {
      return {
        questions: [],
        warnings: [],
        error:
          "El modelo de IA no puede procesar imágenes. Asegúrate de que el texto del documento esté visible como texto seleccionable, no como imágenes escaneadas.",
      };
    }
    return { questions: [], warnings: [], error: `Error con la IA: ${message}` };
  }

  const parsed = parseQuestionsWithAi(documentText, aiResponse);

  // Diagnóstico: si el parser no produjo preguntas (por JSON inválido o
  // array vacío), loggeamos la cabeza y cola de la respuesta cruda del
  // modelo en consola del servidor — y la pegamos a `warnings` para que el
  // docente también la vea. Esto acorta el ciclo de "no sé qué pasó" la
  // próxima vez que la IA falle.
  if (parsed.questions.length === 0) {
    const sanitized = aiResponse.replace(/\s+/g, " ").slice(0, 240);
    const tail = aiResponse.replace(/\s+/g, " ").slice(-160);
    console.warn(`[ai-import] 0 preguntas extraídas. head="${sanitized}" tail="${tail}"`);
    parsed.warnings.push(
      `Modelo devolvió (primeros 240 chars): "${sanitized}${sanitized.length >= 240 ? "…" : ""}"`,
    );
  }

  // Reemplazar placeholders !!IMAGEN N!! por las URLs reales subidas
  if (Object.keys(imageMap).length > 0) {
    for (const q of parsed.questions) {
      if (q.image?.url) {
        const m = q.image.url.match(/^!!IMAGEN\s*(\d+)!!$/i);
        if (m) {
          const url = imageMap[Number(m[1])];
          if (url) q.image.url = url;
        }
      }
    }
  }

  if (parsed.questions.length === 0) {
    return {
      questions: [],
      warnings: parsed.warnings,
      error:
        parsed.warnings.length > 0 ? parsed.warnings.join(" ") : "La IA no pudo extraer preguntas.",
    };
  }

  return parsed;
}
