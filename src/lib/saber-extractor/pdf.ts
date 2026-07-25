import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

export interface PdfChunk {
  /** Índice del chunk (0-based). */
  index: number;
  /** Números de página (1-based) incluidos en este chunk. */
  pages: number[];
  /** PDF del chunk, en base64. */
  base64: string;
}

export interface ChunkOptions {
  /** Páginas por chunk (por defecto 5). */
  chunkSize?: number;
  /** Páginas de solapamiento entre chunks consecutivos (por defecto 1). */
  overlap?: number;
}

/** Lee un PDF de disco y devuelve sus bytes. */
export async function loadPdfBytes(path: string): Promise<Uint8Array> {
  const buf = await readFile(path);
  return new Uint8Array(buf);
}

/** Número de páginas del PDF. */
export async function getPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/**
 * Divide el PDF en sub-documentos por rangos de página, con solapamiento.
 * El solapamiento reduce el riesgo de partir un contexto que cruza el límite
 * de un chunk (luego se deduplica por número de pregunta al fusionar).
 */
export async function splitPdf(
  bytes: Uint8Array,
  { chunkSize = 5, overlap = 1 }: ChunkOptions = {},
): Promise<PdfChunk[]> {
  if (chunkSize < 1) throw new Error("chunkSize debe ser >= 1");
  if (overlap < 0 || overlap >= chunkSize)
    throw new Error("overlap debe estar entre 0 y chunkSize-1");

  const source = await PDFDocument.load(bytes);
  const total = source.getPageCount();
  const step = chunkSize - overlap;

  const chunks: PdfChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < total) {
    const end = Math.min(start + chunkSize, total); // exclusivo
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);

    const out = await PDFDocument.create();
    const copied = await out.copyPages(source, pageIndices);
    copied.forEach((p) => out.addPage(p));
    const outBytes = await out.save();

    chunks.push({
      index,
      pages: pageIndices.map((i) => i + 1),
      base64: Buffer.from(outBytes).toString("base64"),
    });

    index += 1;
    if (end === total) break;
    start += step;
  }

  return chunks;
}

/** Devuelve el PDF completo en base64 (útil para lotes de una sola llamada). */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
