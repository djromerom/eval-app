import { describe, expect, it, type Mock, vi } from "vitest";
import {
  parseQuestionsFromHtml,
  sanitizeImagePlaceholders,
  type UploadImageFn,
} from "@/modules/question-import/infrastructure/docx-parser";

/**
 * Tests del parser DOCX sobre HTML sintético.
 *
 * Mammoth se mockea fuera; aquí llegamos ya al `parseQuestionsFromHtml` para
 * que las pruebas sean rápidas, deterministas y cubran las cuatro variantes
 * de "cómo se reparte el contexto" tras el fix:
 *
 *  - contexto compartido por TODAS las preguntas del bloque,
 *  - contextos DISTINTOS separados por un cambio entre preguntas,
 *  - contexto INTERMEDIO que aparece entre dos preguntas (entre sus opciones),
 *  - UNA sola pregunta de un bloque (caso base que ya funcionaba).
 *
 * Si el parser atribuye mal el contexto, este archivo falla y bloquea el
 * commit. Es la red de seguridad del refactor.
 */

async function parse(
  html: string,
  upload: UploadImageFn = vi.fn(async () => ({ url: "/u/x.jpg" })),
) {
  return parseQuestionsFromHtml({ html, institutionId: "inst-1", uploadImage: upload });
}

describe("parseQuestionsFromHtml — estructura", () => {
  it("reconoce preguntas y opciones bien formadas", async () => {
    const html = `
      <p><strong>1. ¿Cuál es la capital de Colombia?</strong></p>
      <p><strong>A.</strong> Bogotá</p>
      <p><strong>B.</strong> Medellín</p>
      <p><strong>C.</strong> Cali</p>
      <p><strong>D.</strong> Barranquilla</p>
      <p><strong>2. ¿2+2?</strong></p>
      <p><strong>A.</strong> 3</p>
      <p><strong>B.</strong> 4</p>
      <p><strong>C.</strong> 5</p>
      <p><strong>D.</strong> 6</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0]!.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
    expect(res.questions[0]!.text).toMatch(/capital/);
  });

  it("acepta el separador ',' que aparece como errata real", async () => {
    const html = `
      <p><strong>1. Enunciado</strong></p>
      <p><strong>A.</strong> microscopio</p>
      <p><strong>B,</strong> lupa</p>
      <p><strong>C.</strong> telescopio</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]!.options.map((o) => o.text)).toContain("lupa");
    expect(res.questions[0]!.options).toHaveLength(3);
  });

  it("descarta preguntas con menos de 2 opciones", async () => {
    const html = `
      <p><strong>1. Pregunta inválida</strong></p>
      <p><strong>A.</strong> solo una</p>
      <p><strong>2. Pregunta válida</strong></p>
      <p><strong>A.</strong> 1</p>
      <p><strong>B.</strong> 2</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]!.sourceNumber).toBe(2);
  });
});

describe("parseQuestionsFromHtml — tabla de clave", () => {
  it("extrae la clave de una tabla 'Item|Clave|Competencia|Evidencia' y la casa por número", async () => {
    const html = `
      <p><strong>1. Pregunta uno</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p><strong>C.</strong> c</p>
      <p><strong>2. Pregunta dos</strong></p>
      <p><strong>A.</strong> x</p>
      <p><strong>B.</strong> y</p>
      <p><strong>C.</strong> z</p>
      <table>
        <tr>
          <td><p><strong>Item</strong></p></td>
          <td><p><strong>Clave</strong></p></td>
          <td><p><strong>Asignatura</strong></p></td>
          <td><p><strong>Competencia</strong></p></td>
          <td><p><strong>Evidencia</strong></p></td>
        </tr>
        <tr>
          <td><p><strong>1</strong></p></td>
          <td><p><strong>B</strong></p></td>
          <td><p><strong>Biología</strong></p></td>
          <td><p><strong>Indagar</strong></p></td>
          <td><p><strong>Conocer el agua</strong></p></td>
        </tr>
        <tr>
          <td><p><strong>2</strong></p></td>
          <td><p><strong>C</strong></p></td>
          <td><p><strong>Biología</strong></p></td>
          <td><p><strong>Explicar</strong></p></td>
          <td><p><strong>Describir componentes</strong></p></td>
        </tr>
      </table>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0]!.correctAnswer).toBe("B");
    expect(res.questions[0]!.competency).toBe("Indagar");
    expect(res.questions[0]!.evidence).toBe("Conocer el agua");
    expect(res.questions[1]!.correctAnswer).toBe("C");
  });

  it("sin tabla de clave deja correctAnswer=null y avisa globalmente", async () => {
    const html = `
      <p><strong>1. Pregunta</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
    `;
    const res = await parse(html);
    expect(res.questions[0]!.correctAnswer).toBeNull();
    expect(res.warnings.some((w) => /tabla de clave/i.test(w))).toBe(true);
  });
});

describe("parseQuestionsFromHtml — imágenes", () => {
  it("captura la primera imagen inline y la sube vía uploadImage", async () => {
    const html = `
      <p><img src="data:image/jpeg;base64,AAAA" />1. Pregunta con dibujo</p>
      <p><strong>A.</strong> 1</p>
      <p><strong>B.</strong> 2</p>
    `;
    const upload: Mock<UploadImageFn> = vi.fn(async () => ({ url: "/u/uuid.jpg" }));
    const res = await parse(html, upload);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0].contentType).toBe("image/jpeg");
    expect(res.questions[0]!.image?.url).toBe("/u/uuid.jpg");
  });

  it("si la imagen falla al subir, la pregunta queda sin imagen y con aviso", async () => {
    const html = `
      <p><img src="data:image/jpeg;base64,AAAA" />1. Pregunta</p>
      <p><strong>A.</strong> 1</p>
      <p><strong>B.</strong> 2</p>
    `;
    const upload: Mock<UploadImageFn> = vi.fn(async () => ({ error: "fail" }));
    const res = await parse(html, upload);
    expect(res.questions[0]!.image).toBeNull();
    expect(res.questions[0]!.warnings.some((w) => /imagen/i.test(w))).toBe(true);
  });
});

describe("parseQuestionsFromHtml — distribución de contexto", () => {
  it("atribuye el mismo contexto compartido a las 3 preguntas del bloque", async () => {
    const html = `
      <p>RESPONDE LAS PREGUNTAS 1, 2 Y 3 CON BASE EN EL SIGUIENTE TEXTO:</p>
      <p>El agua es una sustancia vital para la vida.</p>
      <p><strong>1. ¿En qué estados se presenta el agua?</strong></p>
      <p><strong>A.</strong> Líquido y gas</p>
      <p><strong>B.</strong> Líquido, sólido y gas</p>
      <p><strong>2. ¿Cuál hierve a mayor temperatura?</strong></p>
      <p><strong>A.</strong> Sal</p>
      <p><strong>B.</strong> Agua</p>
      <p><strong>3. ¿Es conductora?</strong></p>
      <p><strong>A.</strong> Sí</p>
      <p><strong>B.</strong> No</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(3);
    expect(res.questions[0]!.contextText).toMatch(/agua es una sustancia/);
    expect(res.questions[1]!.contextText).toMatch(/agua es una sustancia/);
    expect(res.questions[2]!.contextText).toMatch(/agua es una sustancia/);
  });

  it("concatena en el contexto los párrafos precedentes (multi-bloque de contexto)", async () => {
    const html = `
      <p>Texto A — primera parte del pasaje.</p>
      <p>Texto A — segunda parte del pasaje.</p>
      <p><strong>1. Sobre el pasaje, ¿cuál es correcto?</strong></p>
      <p><strong>A.</strong> 1</p>
      <p><strong>B.</strong> 2</p>
      <p><strong>2. ¿Otra?</strong></p>
      <p><strong>A.</strong> x</p>
      <p><strong>B.</strong> y</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(2);
    const ctx = res.questions[0]!.contextText ?? "";
    expect(ctx).toMatch(/Texto A — primera parte/);
    expect(ctx).toMatch(/Texto A — segunda parte/);
    expect(res.questions[1]!.contextText).toBe(ctx);
  });

  it("cambia de contexto cuando aparece un nuevo bloque entre dos preguntas", async () => {
    const html = `
      <p>Pasaje 1.</p>
      <p><strong>1. Primera del pasaje 1</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p><strong>2. Segunda del pasaje 1</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p>Pasaje 2.</p>
      <p><strong>3. Primera del pasaje 2</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p><strong>4. Segunda del pasaje 2</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(4);
    expect(res.questions[0]!.contextText).toBe("Pasaje 1.");
    expect(res.questions[1]!.contextText).toBe("Pasaje 1.");
    expect(res.questions[2]!.contextText).toBe("Pasaje 2.");
    expect(res.questions[3]!.contextText).toBe("Pasaje 2.");
  });

  it("no replica contextos distintos: cada pregunta mantiene el suyo", async () => {
    const html = `
      <p>Contexto A.</p>
      <p><strong>1. Pregunta 1</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p>Contexto B.</p>
      <p><strong>2. Pregunta 2</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(2);
    expect(res.questions[0]!.contextText).toBe("Contexto A.");
    expect(res.questions[1]!.contextText).toBe("Contexto B.");
  });

  it("sin contexto delante, las preguntas quedan con contextText=null", async () => {
    const html = `
      <p><strong>1. Pregunta una</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p><strong>2. Pregunta dos</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
    `;
    const res = await parse(html);
    expect(res.questions[0]!.contextText).toBeNull();
    expect(res.questions[1]!.contextText).toBeNull();
  });

  it("el contexto NO se atribuye a la pregunta ANTERIOR cuando aparece ENTRE preguntas", async () => {
    // Caso real del usuario: el contexto "Pasaje 2" sale DESPUÉS de las
    // opciones de Q1, así que NO debe quedar como contextText de Q1.
    const html = `
      <p><strong>1. Primera</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
      <p>Pasaje 2 — texto introductorio.</p>
      <p><strong>2. Segunda</strong></p>
      <p><strong>A.</strong> a</p>
      <p><strong>B.</strong> b</p>
    `;
    const res = await parse(html);
    expect(res.questions[0]!.contextText).toBeNull();
    expect(res.questions[1]!.contextText).toBe("Pasaje 2 — texto introductorio.");
  });
});

describe("sanitizeImagePlaceholders", () => {
  it("elimina !!IMAGEN N!! y compacta espacios sobrantes", () => {
    const r = sanitizeImagePlaceholders("Observa el gráfico !!IMAGEN 8!! siguiente.");
    expect(r.text).toBe("Observa el gráfico siguiente.");
    expect(r.removedImagePlaceholder).toBe(true);
  });

  it("reconoce todas las variantes de placeholder y mayúsculas", () => {
    const variants = [
      "!!IMAGEN 3!!",
      "!!image 4!!",
      "!!Img 5!!",
      "!!   FIGURA    6   !!",
      "!!Figure 7!!",
      "!!fig 9!!",
    ];
    for (const v of variants) {
      const r = sanitizeImagePlaceholders(`Antes ${v} después`);
      expect(r.text).toBe("Antes después");
      expect(r.removedImagePlaceholder).toBe(true);
    }
  });

  it("devuelve texto sin cambios si no hay placeholders", () => {
    const r = sanitizeImagePlaceholders("Pregunta sin imágenes.");
    expect(r.text).toBe("Pregunta sin imágenes.");
    expect(r.removedImagePlaceholder).toBe(false);
  });

  it("maneja texto vacío sin reventar", () => {
    expect(sanitizeImagePlaceholders("")).toEqual({
      text: "",
      removedImagePlaceholder: false,
    });
  });
});

describe("parseQuestionsFromHtml — placeholders de imágenes de pdf2docx", () => {
  it("elimina !!IMAGEN N!! del enunciado y deja un warning", async () => {
    const html = `
      <p><strong>1. Observa el gráfico !!IMAGEN 8!! y elige la opción correcta</strong></p>
      <p><strong>A.</strong> Una</p>
      <p><strong>B.</strong> Dos</p>
    `;
    const res = await parse(html);
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0]!.text).not.toMatch(/!!IMAGEN/);
    expect(res.questions[0]!.text).toMatch(/Observa el gráfico y elige/);
    expect(res.questions[0]!.warnings.some((w) => /!!IMAGEN/.test(w))).toBe(true);
  });

  it("elimina placeholders también dentro de las opciones", async () => {
    const html = `
      <p><strong>1. ¿Cuál describe la figura?</strong></p>
      <p><strong>A.</strong> Es un cuadrado !!FIGURA 4!!</p>
      <p><strong>B.</strong> Es un círculo</p>
    `;
    const res = await parse(html);
    const aText = res.questions[0]!.options.find((o) => o.key === "A")?.text ?? "";
    expect(aText).not.toMatch(/!!FIGURA/);
  });

  it("elimina placeholders también del contexto compartido", async () => {
    const html = `
      <p>Lee el siguiente enunciado !!IMAGEN 1!! con atención.</p>
      <p><strong>1. ¿Qué muestra la figura?</strong></p>
      <p><strong>A.</strong> Forma</p>
      <p><strong>B.</strong> Color</p>
      <p><strong>2. ¿Y ahora?</strong></p>
      <p><strong>A.</strong> Igual</p>
      <p><strong>B.</strong> Distinto</p>
    `;
    const res = await parse(html);
    expect(res.questions[0]!.contextText).not.toMatch(/!!IMAGEN/);
    expect(res.questions[1]!.contextText).not.toMatch(/!!IMAGEN/);
  });
});
