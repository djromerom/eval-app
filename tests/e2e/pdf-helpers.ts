import { expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

/**
 * Estructura mínima de un PDF parseado por `parsePdfStructure`.
 *
 * Usa `pdf-lib` (ya es dependencia del proyecto por el worker de imposición)
 * en lugar de regex sobre bytes: Puppeteer emite PDFs con object streams
 * comprimidos (FlateDecode + cross-reference streams) que no contienen los
 * `/MediaBox` como texto plano.
 */
export interface PdfPageBox {
  pageIndex: number; // 0-based
  widthPt: number;
  heightPt: number;
}

/**
 * Lee un buffer PDF y devuelve las dimensiones de cada página. Lanza si no
 * puede parsear o si el PDF no tiene páginas.
 */
export async function parsePdfStructure(buf: Buffer): Promise<PdfPageBox[]> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const pages = doc.getPages();
  if (pages.length === 0) {
    throw new Error("El PDF no contiene páginas");
  }
  return pages.map((p, i) => ({
    pageIndex: i,
    widthPt: p.getWidth(),
    heightPt: p.getHeight(),
  }));
}

/** Verificación rápida de que un buffer es un PDF válido. */
export function assertPdfHeader(buf: Buffer): void {
  expect(buf.subarray(0, 5).toString("ascii"), "header PDF").toBe("%PDF-");
  // El trailer PDF debe estar cerca del final.
  const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString("latin1");
  expect(tail, "trailer %%EOF").toContain("%%EOF");
}

/**
 * Dispara la descarga del PDF desde el botón "Descargar PDF ↓" en la página
 * del docente y devuelve el archivo descargado + las páginas parseadas.
 *
 * Usa el download event de Playwright (no fetch) para emular lo que ve el
 * usuario: clic → archivo al disco.
 */
export async function downloadBookletAndParse(
  page: Page,
  _evaluationId?: string,
): Promise<{ file: Buffer; pages: PdfPageBox[]; filename: string }> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    page.getByRole("button", { name: /Descargar PDF/ }).click(),
  ]);

  const filename = download.suggestedFilename();
  const stream = await download.createReadStream();
  if (!stream) throw new Error(`Download ${filename} no devolvió stream`);

  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  const file = Buffer.concat(chunks);
  assertPdfHeader(file);
  const pages = await parsePdfStructure(file);
  return { file, pages, filename };
}
