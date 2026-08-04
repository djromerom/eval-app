/**
 * Genera un PDF de muestra para los tests E2E de importación IA.
 *
 * Uso:
 *   tsx tests/e2e/fixtures/generate-sample-pdf.ts
 *
 * Produce `tests/e2e/fixtures/sample-exam.pdf` con 2 preguntas en una
 * sola página, texto seleccionable (no escaneado). Pensado para que
 * `saber-extractor.extractExam` tenga material real que procesar.
 *
 * NO se ejecuta automáticamente en CI: este script vive aquí para que un
 * desarrollador pueda regenerar el fixture cuando cambie el esquema de las
 * preguntas, sin tocar el código del test E2E que lo consume.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function main(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]); // letter

  const lines: { text: string; bold?: boolean; size?: number }[] = [
    { text: "Examen de muestra — prueba E2E", bold: true, size: 16 },
    { text: "" },
    { text: "Pregunta 1. ¿Cuál es el resultado de 2 + 2?" },
    { text: "A. 3" },
    { text: "B. 4" },
    { text: "C. 5" },
    { text: "D. 6" },
    { text: "" },
    { text: "Pregunta 2. ¿Cuál es la capital de Francia?" },
    { text: "A. Madrid" },
    { text: "B. Londres" },
    { text: "C. París" },
    { text: "D. Berlín" },
  ];

  let y = 750;
  for (const line of lines) {
    page.drawText(line.text, {
      x: 50,
      y,
      size: line.size ?? 11,
      font: line.bold ? fontBold : font,
    });
    y -= line.text ? 18 : 12;
  }

  const pdfBytes = await doc.save();
  const outDir = join(process.cwd(), "tests/e2e/fixtures");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "sample-exam.pdf");
  await writeFile(outPath, pdfBytes);

  console.log(`✓ Fixture escrito en ${outPath} (${pdfBytes.byteLength} bytes)`);
}

main().catch((err) => {
  console.error("Error generando fixture:", err);
  process.exit(1);
});