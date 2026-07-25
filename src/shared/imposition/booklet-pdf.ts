import { PDFDocument, type PDFPage } from "pdf-lib";
import { TABLOID_PT, buildImposedPageOrder, padToMultipleOf4 } from "./booklet";

/**
 * Imposición saddle-stitch sobre un PDF lineal usando pdf-lib.
 *
 * Recibe un PDF "lineal" (cada página lógica del examen como página carta)
 * y produce un PDF listo para imprenta: pliegos doble carta apaisados (17×11
 * in) con dos medias páginas carta por cara (FRONT_LEFT, FRONT_RIGHT,
 * BACK_LEFT, BACK_RIGHT).
 *
 * Separación de responsabilidades:
 *   - `booklet.ts` define las reglas PURAS de imposition (qué página lógica va
 *     en qué cara del pliego). Sin pdf-lib, sin I/O, totalmente testeable.
 *   - Este módulo aplica esas reglas a un PDF real con pdf-lib.
 *
 * Soporta `coverPages` (≥ 0): las primeras N páginas del PDF lineal se
 * copian tal cual al output (sin imposition) y solo el resto se impone.
 * Uso típico: cuadernillos (`coverPages: 1`) cuya portada institucional NO
 * debe impositionarse — si se impone, queda media hoja tabloid desperdiciada.
 * Para cuadernillos de una sola formulación se deja en 0 (comportamiento
 * histórico: portada y contraportada comparten pliego exterior).
 *
 * Convenciones:
 *   - El PDF de entrada tiene páginas [1, 2, 3, …, N].
 *   - El PDF de salida tiene páginas = (body padded a múltiplo de 4) / 4 * 2,
 *     cada una con dos medias páginas carta lado a lado. Si `coverPages > 0`,
 *     esas páginas van ANTES sin imposition, tamaño carta.
 *   - `outputPageIndex` 0 = anverso del primer pliego del cuerpo, 1 = reverso,
 *     2 = anverso del segundo pliego, etc.
 */
export interface ImposeBookletOptions {
  /**
   * Cuántas páginas del INICIO del PDF lineal se preservan sin imposition
   * (tamaño original, normalmente carta). Por defecto 0 = saddle-stitch
   * TODO el PDF (comportamiento legacy). Usar 1 para cuadernillos.
   */
  coverPages?: number;
}

export async function imposeBooklet(
  linearPdf: Uint8Array,
  opts: ImposeBookletOptions = {},
): Promise<Uint8Array> {
  const coverPages = Math.max(0, Math.floor(opts.coverPages ?? 0));

  const src = await PDFDocument.load(linearPdf);
  const srcPages = src.getPages();
  if (srcPages.length < 1) {
    throw new Error("PDF lineal sin páginas");
  }
  if (coverPages > srcPages.length) {
    throw new Error(`coverPages (${coverPages}) excede páginas del PDF (${srcPages.length})`);
  }

  const out = await PDFDocument.create();

  // 1) Cover pages: copiar tal cual, sin imposition, en su tamaño original.
  if (coverPages > 0) {
    const coverIndices = Array.from({ length: coverPages }, (_, i) => i);
    const coverCopies = await out.copyPages(src, coverIndices);
    for (const p of coverCopies) out.addPage(p);
  }

  // 2) Cuerpo: imponer páginas coverPages..N sobre pliegos doble carta.
  const bodyCount = srcPages.length - coverPages;
  if (bodyCount < 1) return await out.save();

  const padded = padToMultipleOf4(bodyCount);
  const order = buildImposedPageOrder(bodyCount);

  // copyPages devuelve páginas embedidas en `out`; las reutilizamos.
  const bodyIndices = Array.from({ length: bodyCount }, (_, i) => i + coverPages);
  const bodyCopies = await out.copyPages(src, bodyIndices);

  const totalOutputPages = (padded / 4) * 2; // 2 caras por pliego
  for (let i = 0; i < totalOutputPages; i++) {
    const outPage = out.addPage([TABLOID_PT.width, TABLOID_PT.height]);

    // Decidir si esta página de output es anverso o reverso.
    const isBack = i % 2 === 1;
    const sheetIdx = Math.floor(i / 2);
    // Slots del pliego, en orden [FL, FR, BL, BR] = [0, 1, 2, 3].
    const slots = order.slice(sheetIdx * 4, sheetIdx * 4 + 4);

    if (!isBack) {
      // Anverso: dibuja FL (slots[0]) a la izquierda y FR (slots[1]) a la derecha.
      await drawHalf(outPage, bodyCopies, slots[0] ?? null, "left");
      await drawHalf(outPage, bodyCopies, slots[1] ?? null, "right");
    } else {
      // Reverso: el orden izq/der se espeja porque el pliego se voltea por
      // el borde largo al imprimir el reverso. Dibujamos BL (slots[2]) a la
      // derecha y BR (slots[3]) a la izquierda para que coincida.
      await drawHalf(outPage, bodyCopies, slots[3] ?? null, "left");
      await drawHalf(outPage, bodyCopies, slots[2] ?? null, "right");
    }
  }

  return await out.save();
}

/**
 * Pega una página lógica del cuerpo en la mitad izquierda o derecha de un
 * pliego tabloid. Las páginas lógicas están numeradas 1..bodyCount en el
 * espacio del cuerpo (sin contar las coverPages).
 *
 * Es helper privado: solo `imposeBooklet` lo usa.
 */
async function drawHalf(
  outPage: PDFPage,
  bodyCopies: PDFPage[],
  logical: number | null,
  half: "left" | "right",
): Promise<void> {
  if (logical === null) return; // página blanca: dejar en blanco
  const src = bodyCopies[logical - 1];
  if (!src) return;

  const { width: srcW, height: srcH } = src.getSize();
  const halfW = TABLOID_PT.width / 2;
  const halfH = TABLOID_PT.height;

  // Escalar la página fuente para que llene la mitad del pliego.
  const scale = Math.min(halfW / srcW, halfH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;

  // Centrar verticalmente, alinear a la mitad correspondiente horizontalmente.
  const x = half === "left" ? (halfW - drawW) / 2 : halfW + (halfW - drawW) / 2;
  const y = (halfH - drawH) / 2;

  const embedded = await outPage.doc.embedPage(src);
  outPage.drawPage(embedded, { x, y, width: drawW, height: drawH });
}
