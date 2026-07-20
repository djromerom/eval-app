import { describe, expect, it, vi } from "vitest";
import type { UploadImageFn } from "@/modules/question-import/infrastructure/docx-parser";
import {
  parseQuestionsFromHtml,
  splitBlocks,
  parseKeyTable,
} from "@/modules/question-import/infrastructure/docx-parser";

const noopUpload: UploadImageFn = vi.fn(async () => ({ url: "/api/uploads/x/u.jpg" }));

describe("parseQuestionsFromHtml (puro, sin mammoth)", () => {
  it("reconoce preguntas y opciones bien formadas", async () => {
    const html = [
      "<p><strong>1. ¿Cuál es la capital de Colombia?</strong></p>",
      "<p><strong>A.</strong> Bogotá</p>",
      "<p><strong>B.</strong> Medellín</p>",
      "<p><strong>C.</strong> Cali</p>",
      "<p><strong>D.</strong> Barranquilla</p>",
      "<p><strong>2. ¿2+2?</strong></p>",
      "<p><strong>A.</strong> 3</p>",
      "<p><strong>B.</strong> 4</p>",
      "<p><strong>C.</strong> 5</p>",
      "<p><strong>D.</strong> 6</p>",
    ].join("");
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "i1",
      uploadImage: noopUpload,
    });
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0]!.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
    expect(res.questions[0]!.text).toMatch(/capital/);
  });

  it("acepta el separador ',' que aparece como errata real", async () => {
    const html = [
      "<p><strong>1. Enunciado</strong></p>",
      "<p><strong>A.</strong> microscopio</p>",
      "<p><strong>B,</strong> lupa</p>",
      "<p><strong>C.</strong> telescopio</p>",
    ].join("");
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "i1",
      uploadImage: noopUpload,
    });
    expect(res.questions).toHaveLength(1);
    const texts = res.questions[0]!.options.map((o) => o.text);
    expect(texts).toContain("lupa");
    expect(texts.length).toBe(3);
  });

  it("descarta preguntas con menos de 2 opciones", async () => {
    const html = [
      "<p><strong>1. Pregunta inválida</strong></p>",
      "<p><strong>A.</strong> sola una</p>",
      "<p><strong>2. Pregunta válida</strong></p>",
      "<p><strong>A.</strong> 1</p>",
      "<p><strong>B.</strong> 2</p>",
    ].join("");
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "i1",
      uploadImage: noopUpload,
    });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]!.sourceNumber).toBe(2);
  });

  it("extrae la clave de una tabla 'Item|Clave|Competencia|Evidencia' y la casa por número", async () => {
    const html = [
      "<p><strong>1. Pregunta uno</strong></p>",
      "<p><strong>A.</strong> a</p>",
      "<p><strong>B.</strong> b</p>",
      "<p><strong>C.</strong> c</p>",
      "<p><strong>2. Pregunta dos</strong></p>",
      "<p><strong>A.</strong> x</p>",
      "<p><strong>B.</strong> y</p>",
      "<p><strong>C.</strong> z</p>",
      "<table>",
      "<tr><td><p><strong>Item</strong></p></td><td><p><strong>Clave</strong></p></td><td><p><strong>Asignatura</strong></p></td><td><p><strong>Competencia</strong></p></td><td><p><strong>Evidencia</strong></p></td></tr>",
      "<tr><td><p><strong>1</strong></p></td><td><p><strong>B</strong></p></td><td><p><strong>Biología</strong></p></td><td><p><strong>Indagar</strong></p></td><td><p><strong>Conocer el agua</strong></p></td></tr>",
      "<tr><td><p><strong>2</strong></p></td><td><p><strong>C</strong></p></td><td><p><strong>Biología</strong></p></td><td><p><strong>Explicar</strong></p></td><td><p><strong>Describir componentes</strong></p></td></tr>",
      "</table>",
    ].join("");
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "i1",
      uploadImage: noopUpload,
    });
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0]!.correctAnswer).toBe("B");
    expect(res.questions[0]!.competency).toBe("Indagar");
    expect(res.questions[0]!.evidence).toBe("Conocer el agua");
    expect(res.questions[1]!.correctAnswer).toBe("C");
  });

  it("sin tabla de clave deja correctAnswer=null y avisa globalmente", async () => {
    const html = [
      "<p><strong>1. Pregunta</strong></p>",
      "<p><strong>A.</strong> a</p>",
      "<p><strong>B.</strong> b</p>",
    ].join("");
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "i1",
      uploadImage: noopUpload,
    });
    expect(res.questions[0]!.correctAnswer).toBeNull();
    expect(res.warnings.some((w) => /tabla de clave/i.test(w))).toBe(true);
  });

  it("captura la primera imagen inline y la sube vía uploadImage", async () => {
    const html = [
      '<p><img src="data:image/jpeg;base64,AAA" />1. Pregunta con dibujo</p>',
      "<p><strong>A.</strong> 1</p>",
      "<p><strong>B.</strong> 2</p>",
    ].join("");
    const upload = vi.fn(async () => ({ url: "/api/uploads/inst-1/uuid.jpg" }));
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "inst-1",
      uploadImage: upload,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    const firstCall = upload.mock.calls[0] as [{ contentType: string }] | undefined;
    expect(firstCall?.[0]?.contentType).toBe("image/jpeg");
    expect(res.questions[0]!.image?.url).toBe("/api/uploads/inst-1/uuid.jpg");
  });

  it("si la imagen falla al subir, la pregunta queda sin imagen y con aviso", async () => {
    const html = [
      '<p><img src="data:image/jpeg;base64,AAA" />1. Pregunta</p>',
      "<p><strong>A.</strong> 1</p>",
      "<p><strong>B.</strong> 2</p>",
    ].join("");
    const upload: UploadImageFn = vi.fn(async () => ({ error: "fail" }));
    const res = await parseQuestionsFromHtml({ html, institutionId: "i1", uploadImage: upload });
    expect(res.questions[0]!.image).toBeNull();
    expect(res.questions[0]!.warnings.some((w) => /imagen/i.test(w))).toBe(true);
  });

  it("reconoce un enunciado precedido por párrafos de contexto compartido", async () => {
    const html = [
      "<p>RESPONDE LAS PREGUNTAS 1 Y 2 CON BASE EN EL SIGUIENTE TEXTO:</p>",
      "<p>El agua es una sustancia vital para la vida.</p>",
      "<p><strong>1. ¿En qué estados se presenta el agua?</strong></p>",
      "<p><strong>A.</strong> Líquido, sólido y gaseoso</p>",
      "<p><strong>B.</strong> Solo líquido</p>",
      "<p><strong>C.</strong> Sólido y líquido</p>",
    ].join("");
    const res = await parseQuestionsFromHtml({
      html,
      institutionId: "i1",
      uploadImage: noopUpload,
    });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]!.contextText).toMatch(/agua es una sustancia/);
  });
});

describe("splitBlocks / parseKeyTable (helpers internos)", () => {
  it("splitBlocks marca hasInlineImage cuando hay <img> en el párrafo de la pregunta", () => {
    const html = '<p><img src="data:image/png;base64,AAA" />5. Con imagen</p>';
    const blocks = splitBlocks(html);
    const question = blocks.find((b) => b.kind === "question");
    expect(question).toBeDefined();
    if (question && question.kind === "question") {
      expect(question.hasInlineImage).toBe(true);
    }
  });

  it("splitBlocks devuelve contextos como kind='context'", () => {
    const html = "<p>Texto introductorio sin número</p>";
    const blocks = splitBlocks(html);
    expect(blocks.find((b) => b.kind === "context")).toBeDefined();
  });

  it("parseKeyTable extrae la fila parseada correctamente", () => {
    const html =
      "<table>" +
      "<tr><td><p><strong>Item</strong></p></td><td><p><strong>Clave</strong></p></td><td><p><strong>Competencia</strong></p></td><td><p><strong>Evidencia</strong></p></td></tr>" +
      "<tr><td><p><strong>1</strong></p></td><td><p><strong>B</strong></p></td><td><p><strong>Indagar</strong></p></td><td><p><strong>Conocer el agua</strong></p></td></tr>" +
      "</table>";
    const { keyByNumber, globalWarnings } = parseKeyTable(html);
    expect(globalWarnings).toEqual([]);
    expect(keyByNumber.get(1)?.answer).toBe("B");
    expect(keyByNumber.get(1)?.competency).toBe("Indagar");
  });

  it("parseKeyTable avisa cuando no hay ninguna fila válida", () => {
    const html =
      "<table>" +
      "<tr><td><p><strong>Item</strong></p></td><td><p><strong>Clave</strong></p></td></tr>" +
      "<tr><td><p>foo</p></td><td><p>bar</p></td></tr>" +
      "</table>";
    const { globalWarnings } = parseKeyTable(html);
    expect(globalWarnings.some((w) => /ninguna fila/i.test(w))).toBe(true);
  });
});
