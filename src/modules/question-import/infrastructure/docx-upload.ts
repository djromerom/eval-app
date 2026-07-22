import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_MIME,
  UPLOAD_URL_PREFIX,
  uploadRelativePath,
} from "@/modules/uploads/domain/upload";
import type { UploadImageFn } from "./docx-parser";

/**
 * Adaptador entre el parser DOCX y el endpoint `/api/uploads`.
 *
 * El parser pide `uploadImage` por cada imagen inline; esta implementación
 * replica LOCALMENTE la lógica del endpoint (sin round-trip HTTP) para evitar
 * serializar y deserializar el DOCX al servidor dos veces. La imagen sigue
 * terminando en disco bajo `evaluations/{institutionId}/{uuid}.jpg`.
 *
 * Si quisiéramos invocarlo a través de la red (p. ej. cuando el parser viva
 * en un worker), bastaría con otra implementación de `UploadImageFn` que
 * haga `fetch("/api/uploads", { method: "POST", body: formData })`.
 */
export function makeUploadImageForInstitution(): UploadImageFn {
  return async ({ institutionId, contentType, base64 }) => {
    if (!UPLOAD_MIME.has(contentType)) {
      return { error: `Tipo de imagen no soportado: ${contentType}` };
    }
    const binary = Buffer.from(base64, "base64");
    if (binary.byteLength > MAX_UPLOAD_BYTES) {
      return {
        error: `Imagen demasiado grande (máx ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`,
      };
    }
    let processed: Buffer;
    try {
      processed = await normalizeImage(binary);
    } catch {
      return { error: "El archivo no es una imagen válida." };
    }
    const relative = uploadRelativePath(institutionId, randomUUID());
    await localStorage.save(relative, processed);
    return { url: `${UPLOAD_URL_PREFIX}${relative}` };
  };
}

async function normalizeImage(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}
