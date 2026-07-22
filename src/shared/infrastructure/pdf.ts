import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const exec = promisify(execFile);

const PY_SCRIPT = `
import sys, json
try:
    from pdf2docx import Converter
except ImportError:
    print(json.dumps({"ok": False, "error": "pdf2docx no instalado. Ejecuta: pip install pdf2docx"}))
    sys.exit(1)

pdf_path, docx_path = sys.argv[1], sys.argv[2]
try:
    cv = Converter(pdf_path)
    cv.convert(docx_path, start=0, end=None)
    cv.close()
    print(json.dumps({"ok": True}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
    sys.exit(1)
`.trimStart();

function parseResult(raw: string): { ok: true } | { ok: false; error: string } {
  try {
    return JSON.parse(raw.trim().split("\n").pop() ?? "{}");
  } catch {
    return { ok: false, error: "Respuesta inesperada de pdf2docx" };
  }
}

/**
 * Convierte un PDF a DOCX usando pdf2docx (Python).
 * Devuelve el buffer del DOCX generado.
 */
export async function pdfToDocx(pdfBuffer: Uint8Array): Promise<Uint8Array> {
  const tmpDir = mkdtempSync(join(tmpdir(), "eval-pdf-"));
  const pdfPath = join(tmpDir, "input.pdf");
  const docxPath = join(tmpDir, "output.docx");

  try {
    writeFileSync(pdfPath, pdfBuffer);

    const { stdout, stderr } = await exec("python3", ["-c", PY_SCRIPT, pdfPath, docxPath]);

    const result = parseResult(stdout || stderr);
    if (!result.ok) {
      throw new Error(result.error);
    }

    return readFileSync(docxPath);
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw new Error(
        "Python 3 no está disponible en el servidor. Instálalo o convierte el PDF a DOCX manualmente.",
      );
    }
    if (err instanceof Error && err.message.includes("pdf2docx")) {
      throw err;
    }
    throw new Error(
      `Error convirtiendo PDF a DOCX: ${err instanceof Error ? err.message : "desconocido"}`,
    );
  } finally {
    for (const f of [pdfPath, docxPath]) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    try {
      rmdirSync(tmpDir);
    } catch {
      /* ignore */
    }
  }
}
