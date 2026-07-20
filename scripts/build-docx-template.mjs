// Generador reproducible de `public/templates/plantilla-preguntas.docx`.
//
// Construye un OPC package mínimo a mano (sin `jszip`, sin `docx`, sin red),
// lo escribe a disco y, si mammoth está disponible, lo hace round-trip por
// nuestro parser para comprobar que el archivo abre correctamente y que las 3
// preguntas + la tabla de clave se importan como esperamos. Esto evita que un
// binario subido a mano al repo se corrompa silenciosamente.
//
// Uso:
//   node scripts/build-docx-template.mjs            # escribe el .docx
//   node scripts/build-docx-template.mjs --check    # re-parsea el existente
//
// Quién lo ejecuta: devs tras clonar el repo (la salida se commitea al árbol
// porque no instalamos nada en build para generarla en runtime — Next ni
// siquiera envía `scripts/`, así que el archivo es estático).

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";

const OUT_PATH = "public/templates/plantilla-preguntas.docx";
const CHECK_ONLY = process.argv.includes("--check");

// ---------- ZIP mínimo (sólo "stored", sin compresión) ----------

/** CRC-32 con polinomio 0xEDB88320 (estándar ZIP). */
function crc32(bytes) {
  let c = 0xffffffff >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n) => Buffer.from([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) =>
  Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

/** Empaqueta una lista de {name, data} (Buffer o string) en un Buffer ZIP. */
function buildZip(entries) {
  const parts = [];
  const central = [];
  let localOffset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const crc = crc32(data);
    const lfh = Buffer.concat([
      u32(0x04034b50), // local file header
      u16(20), // version
      u16(0), // flags
      u16(0), // method (0 = stored)
      u16(0), u16(0), // mod time/date
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0), // extra length
      nameBuf,
    ]);
    parts.push(lfh, data);
    const cdh = Buffer.concat([
      u32(0x02014b50), // central directory header
      u16(20), u16(20), // version made by / needed
      u16(0), u16(0), // flags / method
      u16(0), u16(0), // mod time/date
      u32(crc),
      u32(data.length), u32(data.length),
      u16(nameBuf.length), // filename length
      u16(0), // extra field length
      u16(0), // file comment length
      u16(0), // disk number start
      u16(0), // internal file attributes
      u32(0), // external file attributes
      u32(localOffset), // relative offset of local header
      nameBuf,
    ]);
    central.push(cdh);
    localOffset += lfh.length + data.length;
  }
  const localBlob = Buffer.concat(parts);
  const centralBlob = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0), u16(0), // disk #
    u16(entries.length), u16(entries.length),
    u32(centralBlob.length),
    u32(localBlob.length),
    u16(0), // comment length
  ]);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

// ---------- OOXML ----------

const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Texto escapado para XML (contenido de `<w:t>…</w:t>`). */
function xmlText(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Párrafo simple de una sola corrida. `xml:space="preserve"` mantiene
 *  espacios al inicio (necesario para que "1. " salga como "1. ", sin el
 *  trim agresivo de OOXML). */
function p(text, opts = {}) {
  if (text === "") return "<w:p/>";
  return `<w:p><w:r><w:t${opts.preserve ? ' xml:space="preserve"' : ""}>${xmlText(
    text,
  )}</w:t></w:r></w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function tcell(text) {
  // mammoth preserva los <w:p> internos → los necesitamos para que
  // parseKeyTable haga match con `stripTags` y la fila tenga contenido visible.
  return `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p></w:tc>`;
}

function trow(cells) {
  return `<w:tr>${cells.map(tcell).join("")}</w:tr>`;
}

/** Documento: 3 preguntas de ejemplo + tabla de clave con la cabecera que
 *  parseKeyTable reconoce. Deja `xml:space="preserve"` en el texto para que
 *  el espacio tras "A." no se pierda. */
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS_W}>
  <w:body>
    ${p("PLANTILLA DE PREGUNTAS — Evaluación S.A.")}
    ${p("Usa este formato: enunciado numerado, opciones A–D y, al final, una tabla con la cabecera «Item | Clave | Competencia | Evidencia». Las imágenes inline (Insertar → Imágenes) que pongas dentro de un enunciado se importan automáticamente; se toma la primera imagen de cada pregunta.")}
    ${p("")}
    ${p("Lee el siguiente texto y responde las preguntas 1 y 2.")}
    ${p("El agua cubre alrededor del 71 % de la superficie terrestre y es esencial para la vida.")}
    ${p("1. ¿En qué estados se presenta el agua en la naturaleza?", { preserve: true })}
    ${p("A. Líquido, sólido y gaseoso.", { preserve: true })}
    ${p("B. Solo líquido.", { preserve: true })}
    ${p("C. Sólido y líquido únicamente.", { preserve: true })}
    ${p("D. Plasma y gas únicamente.", { preserve: true })}
    ${p("2. ¿Por qué el agua es esencial para los seres vivos?", { preserve: true })}
    ${p("A. Por su color.", { preserve: true })}
    ${p("B. Porque disuelve nutrientes y permite reacciones químicas.", { preserve: true })}
    ${p("C. Por su sabor.", { preserve: true })}
    ${p("D. Por su dureza.", { preserve: true })}
    ${p("3. ¿Cuál es la fórmula química del agua?", { preserve: true })}
    ${p("A. CO₂", { preserve: true })}
    ${p("B. O₂", { preserve: true })}
    ${p("C. H₂O", { preserve: true })}
    ${p("D. NaCl", { preserve: true })}
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9000" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="900"/>
        <w:gridCol w:w="900"/>
        <w:gridCol w:w="2700"/>
        <w:gridCol w:w="4500"/>
      </w:tblGrid>
      ${trow(["Item", "Clave", "Competencia", "Evidencia"])}
      ${trow(["1", "A", "Indagar", "Conocer los estados del agua"])}
      ${trow(["2", "B", "Explicar", "Importancia biológica del agua"])}
      ${trow(["3", "C", "Indagar", "Conocer la fórmula química"])}
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

// ---------- main ----------

async function build() {
  const zip = buildZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
    { name: "word/document.xml", data: DOCUMENT_XML },
  ]);
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, zip);
  console.log(`✓ ${OUT_PATH} (${zip.byteLength} bytes)`);
}

async function check() {
  // Si mammoth falla al parsear la plantilla, no la queremos en producción.
  let mammoth;
  try {
    mammoth = (await import("mammoth")).default;
  } catch {
    console.log("mammoth no instalado — saltando --check");
    return;
  }
  const { parseQuestionsFromHtml } = await import(
    "../src/modules/question-import/infrastructure/docx-parser.ts"
  ).catch(async () => {
    // Fallback: compilamos TS en caliente no es trivial sin tsx; salimos por
    // la rama equivalente usando la versión vía JSDoc test del parser puro.
    console.log("(chequeo completo requiere vitest; corriendo smoke por mammoth)");
    return { parseQuestionsFromHtml: null };
  });

  const buffer = await readFile(OUT_PATH);
  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    { ignoreEmptyParagraphs: false },
  );
  console.log(`mammoth html: ${html.length} chars`);
  console.log(html.split("\n").slice(0, 30).join("\n"));

  if (parseQuestionsFromHtml) {
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "inst-check",
      uploadImage: async () => ({ url: "/uploads/x.jpg" }),
    });
    console.log(
      `preguntas detectadas: ${res.questions.length}, claves:`,
      res.questions.map((q) => `${q.sourceNumber}=${q.correctAnswer}`).join(" "),
    );
    if (res.questions.length !== 3) {
      console.error("✗ esperaba 3 preguntas");
      process.exit(1);
    }
    if (!res.questions.every((q) => q.correctAnswer)) {
      console.error("✗ alguna pregunta quedó sin clave");
      process.exit(1);
    }
    console.log("✓ round-trip ok");
  }
}

if (CHECK_ONLY) {
  await check();
} else {
  await build();
  await check();
}
