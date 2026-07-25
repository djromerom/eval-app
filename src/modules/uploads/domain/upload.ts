/**
 * Reglas de las imágenes que el docente sube al contenido de una formulación.
 * Sin dependencias de infraestructura: lo usan tanto la ruta de API como el
 * inlineador de impresión.
 */

/** El navegador solo emite estos tipos al pegar o arrastrar una imagen. */
export const UPLOAD_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Tope antes de procesar. Una foto de celular ronda los 3-5 MB. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Prefijo de las URL que sirve `/api/uploads/[...path]`. Se usa para decidir
 * qué imágenes de un documento TipTap son nuestras y hay que incrustar al
 * imprimir: una `https://…` ajena se deja intacta.
 */
export const UPLOAD_URL_PREFIX = "/api/uploads/";

/** Todas las subidas cuelgan del tenant, para poder validarlo al servirlas. */
export function uploadRelativePath(institutionId: string, id: string): string {
  return `evaluations/${institutionId}/${id}.jpg`;
}

/**
 * Extrae la ruta relativa en disco de una URL servida por `/api/uploads/`.
 * Devuelve `null` si la URL no es nuestra (externa, `data:`, vacía…).
 */
export function storagePathFromUploadUrl(src: unknown): string | null {
  if (typeof src !== "string" || !src.startsWith(UPLOAD_URL_PREFIX)) return null;
  const relative = src.slice(UPLOAD_URL_PREFIX.length);
  // Defensa en profundidad: `localStorage` ya rechaza el traversal, pero así
  // ni siquiera se intenta leer una ruta con "..".
  if (!relative || relative.includes("..")) return null;
  return relative;
}

/**
 * `institutionId` al que pertenece una ruta de subida, según su primer
 * segmento. Permite comprobar el tenant sin consultar la base de datos.
 */
export function institutionIdFromPath(relative: string): string | null {
  const parts = relative.split("/");
  if (parts.length < 3 || parts[0] !== "evaluations") return null;
  return parts[1] ?? null;
}
