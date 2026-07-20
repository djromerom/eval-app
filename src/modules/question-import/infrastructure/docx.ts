import type { ParseResult } from "../domain/parsed-question";
import type { UploadImageFn } from "./docx-parser";
import { parseQuestionsFromHtml } from "./docx-parser";

// mammoth no trae tipos publicados en DefinitelyTyped (no existe
// `@types/mammoth`), así que tomamos el módulo vía dynamic import y lo casteamos
// al subconjunto de la API que usamos. Si en el futuro lo actualizan, basta
// con reemplazar este cast por `import mammoth from "mammoth"`.
type MammothModule = {
  convertToHtml: (
    input: { buffer: Buffer },
    options?: { ignoreEmptyParagraphs?: boolean },
  ) => Promise<{ value: string; messages: ReadonlyArray<{ message: string }> }>;
};

export interface ParseQuestionsDocxInput {
  buffer: Buffer;
  institutionId: string;
  uploadImage: UploadImageFn;
}

/**
 * Parser DOCX con mammoth.
 *
 * Delega el reconocimiento de patrones sobre el HTML a `docx-parser`, que se
 * prueba sin mockear mammoth. Este módulo es solo la frontera con la
 * dependencia pesada: convertir el DOCX a HTML y pasar a la fase pura.
 *
 * Detalles que se cubre en `docx-parser`:
 * - Pregunta por regex sobre el texto sin etiquetas.
 * - Opción con separador `,`, `;`, `:`, `)` y `.`.
 * - Tabla de clave "Item | Clave | Competencia | Evidencia".
 * - Contexto compartido entre preguntas.
 * - Imagen inline: la primera `data:image/...;base64,...` se sube vía
 *   `uploadImage` y se devuelve su URL.
 *
 * Errores previsibles y no fatales (manejados en `parseQuestionsFromHtml`):
 * - DOCX sin tabla de clave → `warnings` global; todas las preguntas quedan
 *   sin `correctAnswer` y la revisión obliga a marcarlas.
 * - Imagen que falla al subir → la pregunta se queda sin imagen y se añade
 *   `warnings` local.
 * - Pregunta con menos de 2 opciones → no se incluye.
 */
export async function parseQuestionsDocx({
  buffer,
  institutionId,
  uploadImage,
}: ParseQuestionsDocxInput): Promise<ParseResult> {
  const mammothModule = (await import("mammoth")) as { default?: MammothModule } & MammothModule;
  const mammoth = (mammothModule.default ?? mammothModule) as MammothModule;
  const { value: html } = await mammoth.convertToHtml({ buffer }, { ignoreEmptyParagraphs: false });

  return parseQuestionsFromHtml({ html, institutionId, uploadImage });
}

// Re-export público para los consumidores que quieran probar sin el DOCX.
export { parseQuestionsFromHtml } from "./docx-parser";
export type { UploadImageFn } from "./docx-parser";
