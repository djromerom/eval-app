import { describe, expect, it } from "vitest";
import { parseQuestionsCsv } from "@/modules/question-import/infrastructure/csv";

describe("parseQuestionsCsv", () => {
  it("falla con las columnas mínimas si falta enunciado o correcta", () => {
    expect(parseQuestionsCsv("a,b,c").missing).toContain("text");
    expect(parseQuestionsCsv("enunciado,a,b,c,d").missing).toContain("correctAnswer");
  });

  it("autodetecta delimitador ',' y ';'", () => {
    const comma = parseQuestionsCsv("enunciado,a,b,c,d,correcta\n¿x?,1,2,3,4,B");
    expect(comma.result.questions).toHaveLength(1);
    expect(comma.result.questions[0]?.correctAnswer).toBe("B");

    const semicolon = parseQuestionsCsv("enunciado;a;b;c;d;correcta\n¿x?;1;2;3;4;B");
    expect(semicolon.result.questions).toHaveLength(1);
    expect(semicolon.result.questions[0]?.correctAnswer).toBe("B");
  });

  it("acepta sinónimos de encabezado (pregunta, clave, lectura)", () => {
    const out = parseQuestionsCsv(
      "pregunta,opcion a,opcion b,opcion c,opcion d,clave,lectura\n¿y?,a,b,c,d,A,contexto",
    );
    expect(out.missing).toEqual([]);
    expect(out.result.questions).toHaveLength(1);
    expect(out.result.questions[0]?.text).toBe("¿y?");
    expect(out.result.questions[0]?.correctAnswer).toBe("A");
    expect(out.result.questions[0]?.contextText).toBe("contexto");
  });

  it("ignora filas sin enunciado y avisa de las que tienen menos de 2 opciones", () => {
    const ok = parseQuestionsCsv(
      "enunciado,a,b,c,d,correcta\n¿x?,1,2,3,4,B\n,1,2,3,4,A\n¿y?,1,2,3,C",
    );
    expect(ok.result.questions).toHaveLength(2);
    expect(ok.result.warnings).toHaveLength(0);

    // Una fila con 0 opciones (todas vacías) debe generar aviso y no entrar.
    const bad = parseQuestionsCsv("enunciado,a,b,c,d,correcta\n¿z?,,,,,B");
    expect(bad.result.questions).toHaveLength(0);
    expect(bad.result.warnings.some((w) => w.includes("0 opci"))).toBe(true);
  });

  it("normaliza claves de opción y reubica la correcta", () => {
    const out = parseQuestionsCsv("enunciado,b,c,d,e,correcta\n¿x?,1,2,3,4,D");
    expect(out.result.questions[0]?.options.map((o) => o.key)).toEqual(["A", "B", "C", "D"]);
    // "D" apuntaba a la 3ª opción visible (B,C,D,E → tras normalizar queda
    // en posición 3 → "C").
    expect(out.result.questions[0]?.correctAnswer).toBe("C");
  });

  it("avisa si la columna correcta no es A–H", () => {
    const out = parseQuestionsCsv("enunciado,a,b,c,d,correcta\n¿x?,1,2,3,4,XYZ");
    expect(out.result.questions[0]?.correctAnswer).toBeNull();
    expect(out.result.warnings.some((w) => w.includes("XYZ"))).toBe(true);
  });

  it("respeta comillas dobles y escapes", () => {
    const out = parseQuestionsCsv('enunciado,a,b,c,d,correcta\n"¿""x""?",1,2,3,4,B');
    expect(out.result.questions[0]?.text).toBe('¿"x"?');
  });

  it("rellena competencia y evidencia cuando vienen", () => {
    const out = parseQuestionsCsv(
      "enunciado,a,b,c,d,correcta,competencia,evidencia\n¿x?,1,2,3,4,B,Numérica,Suma",
    );
    expect(out.result.questions[0]?.competency).toBe("Numérica");
    expect(out.result.questions[0]?.evidence).toBe("Suma");
  });
});
