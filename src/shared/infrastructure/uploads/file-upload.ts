import { randomUUID } from "node:crypto";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import { MAX_UPLOAD_BYTES, UPLOAD_URL_PREFIX } from "@/modules/uploads/domain/upload";

/**
 * Sube un archivo binario arbitrario (PDF, DOCX, etc.) al storage institucional
 * y devuelve tanto la URL servible como el path relativo — el segundo lo
 * preserva el `QuestionImportJob.pdfRelativePath` para que el worker pueda
 * recuperarlo desde disco.
 *
 * Es el gemelo de `makeUploadImageForInstitution()` (en `docx-upload.ts`),
 * sin resize de sharp: estos archivos no son imágenes y no los queremos
 * recomprimir. El cap de tamaño (`MAX_UPLOAD_BYTES`) lo impone la capa de
 * uploads para mantener el mismo techo que las imágenes.
 *
 * Los archivos de import viven bajo `imports/{institutionId}/...` (no
 * `evaluations/`) para que un cron de limpieza los pueda barrer por
 * subdirectorio sin tocar las imágenes de evaluaciones publicadas.
 */
export type UploadFileFn = (params: {
  institutionId: string;
  bytes: Buffer;
  /** Extensión SIN punto; el sistema decide la ruta completa. */
  extension: string;
}) => Promise<{ url: string; relativePath: string } | { error: string }>;

export function makeUploadFileForInstitution(): UploadFileFn {
  return async ({ institutionId, bytes, extension }) => {
    const ext = extension.replace(/^\./, "").toLowerCase();
    if (!ext || !/^[a-z0-9]{1,8}$/.test(ext)) {
      return { error: `Extensión inválida: "${extension}".` };
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return {
        error: `Archivo demasiado grande (máx ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`,
      };
    }
    const id = randomUUID();
    const relative = `imports/${institutionId}/${id}.${ext}`;
    await localStorage.save(relative, bytes);
    return { url: `${UPLOAD_URL_PREFIX}${relative}`, relativePath: relative };
  };
}
