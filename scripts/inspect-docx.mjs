// Utilidad local para inspeccionar cómo mammoth ve un DOCX real.
// NO se commitea al bundle.
import { readFile, writeFile } from "node:fs/promises";
import mammoth from "mammoth";

const target = process.argv[2];
if (!target) {
  console.error("uso: node scripts/inspect-docx.mjs <ruta.docx>");
  process.exit(1);
}

const buffer = await readFile(target);
const result = await mammoth.convertToHtml(
  { buffer },
  { includeDefaultStyleMap: true, ignoreEmptyParagraphs: false },
);
await writeFile("/tmp/mammoth-output.html", result.value);
console.log("bytes:", result.value.length, "messages:", result.messages.length);
console.log("primeras 200 líneas:");
console.log(result.value.split("\n").slice(0, 200).join("\n"));
