import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { parseQuestionsFromHtml } from "@/modules/question-import/infrastructure/docx-parser";
import type { UploadImageFn } from "@/modules/question-import/infrastructure/docx-parser";

/**
 * Test de humo del archivo generado por `scripts/build-docx-template.mjs`.
 *
 * Garantiza que la plantilla que el docente se descarga produce, al parsearse
 * por mammoth + nuestro parser, exactamente las preguntas que la UI promete:
 * 3 ítems con clave A/B/C extraídas de la tabla. Si alguien rompe el script
 * (zipea mal, omite XML, etc.) este test falla en CI antes de subir el fix.
 */
describe("plantilla-preguntas.docx", () => {
  it("round-trip: mammoth → parseQuestionsFromHtml reconoce 3 preguntas con su clave", async () => {
    const path = "public/templates/plantilla-preguntas.docx";
    const buffer = await readFile(path);
    const { value: html } = await mammoth.convertToHtml(
      { buffer },
      { ignoreEmptyParagraphs: false },
    );

    const upload: UploadImageFn = vi.fn(async () => ({
      url: "/api/uploads/x/u.jpg",
    }));
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "inst-check",
      uploadImage: upload,
    });

    expect(res.warnings).toEqual([]);
    expect(res.questions).toHaveLength(3);
    expect(res.questions.map((q) => q.correctAnswer)).toEqual(["A", "B", "C"]);
    expect(res.questions.map((q) => q.sourceNumber)).toEqual([1, 2, 3]);
    // No hay imágenes en la plantilla por simplicidad; el campo debe quedar null.
    expect(res.questions.every((q) => q.image === null)).toBe(true);
    // El contexto compartido se asigna a la primera pregunta.
    expect(res.questions[0]!.contextText).toMatch(/agua cubre alrededor del 71/);
    expect(res.questions[0]!.competency).toBe("Indagar");
    expect(res.questions[0]!.evidence).toBe("Conocer los estados del agua");
    expect(res.questions[1]!.competency).toBe("Explicar");
  });
});
