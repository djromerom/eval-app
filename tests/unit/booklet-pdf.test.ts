import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { imposeBooklet } from "@/shared/imposition/booklet-pdf";
import { TABLOID_PT } from "@/shared/imposition/booklet";

/**
 * Construye un PDF lineal sintético con N páginas carta (612×792 pt) sin
 * contenido: solo necesitamos que existan para que `imposeBooklet` pueda
 * pegarlas en los slots. pdf-lib ignora el contenido, solo importa el tamaño.
 *
 * Devuelve `Uint8Array` directamente (no `Buffer`) para casar con la firma
 * de `imposeBooklet`.
 */
async function makeLetterPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    // pdf-lib rechaza embeddear páginas sin stream de Contents
    // (`Can't embed page with missing Contents`). Dibujar cualquier
    // primitiva basta para que la página tenga un Contents asociado;
    // el contenido real no nos interesa — solo el tamaño y la cuenta
    // para `imposeBooklet`.
    page.drawText(String(i + 1), { x: 50, y: 50, size: 12, font });
  }
  return await doc.save();
}

/**
 * Devuelve el tamaño de cada página del PDF. Útil para distinguir
 * portada preservada (612×792) de páginas impuestas (1224×792).
 */
async function pageSizes(buf: Uint8Array): Promise<Array<{ width: number; height: number }>> {
  const doc = await PDFDocument.load(buf);
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
}

describe("imposeBooklet — saddle-stitch con pdf-lib", () => {
  it("lanza error si el PDF lineal está vacío", async () => {
    // Un PDF con 0 páginas revienta al cargar: lo creamos con 1 y luego
    // probamos la guarda real (coverPages > N).
    const pdf = await makeLetterPdf(1);
    await expect(imposeBooklet(pdf, { coverPages: 5 })).rejects.toThrow(/coverPages/);
  });

  it("coverPages por defecto = 0 preserva el comportamiento legacy (single-eval)", async () => {
    // 4 páginas lógicas → 1 pliego → 2 caras tabloid. Cero páginas de cover.
    const pdf = await makeLetterPdf(4);
    const out = await imposeBooklet(pdf);
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(2);
    for (const s of sizes) {
      expect(s).toEqual({ width: TABLOID_PT.width, height: TABLOID_PT.height });
    }
  });

  it("coverPages=1 preserva la primera página (portada compendio) sin imposition", async () => {
    // Caso real del bug: 12 páginas = portada + 11 body.
    // Cover (1 carta) + body padded(11)=12 → 12/4*2 = 6 caras tabloid.
    // Total: 1 + 6 = 7 PDF pages.
    const pdf = await makeLetterPdf(12);
    const out = await imposeBooklet(pdf, { coverPages: 1 });
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(7);
    // Portada: preservada a tamaño carta.
    expect(sizes[0]).toEqual({ width: 612, height: 792 });
    // Resto: impuesto en pliegos doble carta.
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toEqual({ width: TABLOID_PT.width, height: TABLOID_PT.height });
    }
  });

  it("coverPages=1 con N=1 (solo portada): 1 página carta, ningún pliego", async () => {
    const pdf = await makeLetterPdf(1);
    const out = await imposeBooklet(pdf, { coverPages: 1 });
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toEqual({ width: 612, height: 792 });
  });

  it("coverPages=1 con N=5 (portada + 4 body) = 1 carta + 2 tabloid", async () => {
    // body=4 → padded(4)=4 → 4/4*2 = 2 caras tabloid (1 pliego).
    const pdf = await makeLetterPdf(5);
    const out = await imposeBooklet(pdf, { coverPages: 1 });
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(3);
    expect(sizes[0]).toEqual({ width: 612, height: 792 });
    expect(sizes[1]).toEqual({ width: TABLOID_PT.width, height: TABLOID_PT.height });
    expect(sizes[2]).toEqual({ width: TABLOID_PT.width, height: TABLOID_PT.height });
  });

  it("coverPages=1 con body impar (13 body pages) parchea con blancos al final", async () => {
    // N=14 → body=13 → padded(13)=16 → 16/4*2 = 8 caras tabloid.
    // Total: 1 + 8 = 9 PDF pages.
    const pdf = await makeLetterPdf(14);
    const out = await imposeBooklet(pdf, { coverPages: 1 });
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(9);
    expect(sizes[0]).toEqual({ width: 612, height: 792 });
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toEqual({ width: TABLOID_PT.width, height: TABLOID_PT.height });
    }
  });

  it("coverPages=N entero: solo cover, sin imposition (caso degenerado)", async () => {
    // Útil si el compendio alguna vez genera N=2 (cover + 1 body muy corto).
    // Lo dejamos cubierto para no romper al usuario si N==coverPages.
    const pdf = await makeLetterPdf(2);
    const out = await imposeBooklet(pdf, { coverPages: 2 });
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(2);
    for (const s of sizes) {
      expect(s).toEqual({ width: 612, height: 792 });
    }
  });

  it("coverPages no entero se trunca a 0 (defensa contra valores raros)", async () => {
    const pdf = await makeLetterPdf(4);
    const out = await imposeBooklet(pdf, { coverPages: 1.7 });
    const sizes = await pageSizes(out);

    // 1.7 → Math.floor → 1 → 1 carta + body=3 → padded(3)=4 → 2 tabloid.
    expect(sizes).toHaveLength(3);
    expect(sizes[0]).toEqual({ width: 612, height: 792 });
  });

  it("coverPages negativos se tratan como 0 (defensa)", async () => {
    const pdf = await makeLetterPdf(4);
    const out = await imposeBooklet(pdf, { coverPages: -3 });
    const sizes = await pageSizes(out);

    expect(sizes).toHaveLength(2);
    for (const s of sizes) {
      expect(s).toEqual({ width: TABLOID_PT.width, height: TABLOID_PT.height });
    }
  });
});
