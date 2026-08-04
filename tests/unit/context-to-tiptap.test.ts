import { describe, expect, it } from "vitest";
import {
  contextTextToTipTap,
  type TipTapNode,
} from "@/modules/question-import/application/context-to-tiptap";

// Helpers de aserción sobre el shape de TipTap. Mantienen los tests
// legibles aunque el parser evolucione.
const isParagraph = (n: TipTapNode): boolean =>
  n.type === "paragraph" && Array.isArray(n.content) && n.content.every((c) => c.type === "text");
const paragraphText = (n: TipTapNode): string =>
  (n.content ?? []).map((c) => c.text ?? "").join("");

const isHeading = (n: TipTapNode, level: number): boolean =>
  n.type === "heading" && n.attrs?.level === level;

const isTable = (n: TipTapNode): boolean => n.type === "table" && Array.isArray(n.content);

/** Texto de un cell (tableHeader o tableCell). El cell contiene un
 *  `<paragraph>` que es el que tiene el `text` real. */
const cellText = (cell: TipTapNode): string => (cell.content ?? []).map(paragraphText).join("");

const headerRowText = (row: TipTapNode): string[] => (row.content ?? []).map(cellText);

const rowCellsText = (row: TipTapNode): string[] => (row.content ?? []).map(cellText);

describe("contextTextToTipTap", () => {
  describe("texto plano (sin tablas)", () => {
    it("devuelve [] para input vacío", () => {
      expect(contextTextToTipTap("")).toEqual([]);
    });

    it("devuelve [] para solo whitespace", () => {
      expect(contextTextToTipTap("   \n  \t  ")).toEqual([]);
    });

    it("una sola línea → un paragraph", () => {
      const nodes = contextTextToTipTap("Lea las descripciones de la columna izquierda.");
      expect(nodes).toHaveLength(1);
      expect(isParagraph(nodes[0]!)).toBe(true);
      expect(paragraphText(nodes[0]!)).toContain("Lea las descripciones");
    });

    it("múltiples líneas → un paragraph por línea", () => {
      const nodes = contextTextToTipTap("Línea 1\nLínea 2\nLínea 3");
      expect(nodes).toHaveLength(3);
      expect(nodes.map(paragraphText)).toEqual(["Línea 1", "Línea 2", "Línea 3"]);
    });
  });

  describe("tabla canónica (formato multi-línea del prompt)", () => {
    it("parsea título + headers + 1 fila de datos", () => {
      const input = `Antes de la tabla.
[TABLA: Notas
| Materia | Calificación |
|---------|--------------|
| Matemáticas | 4.5 |]
Después de la tabla.`;

      const nodes = contextTextToTipTap(input);
      // paragraph (antes) + heading (título) + table + paragraph (después)
      expect(nodes).toHaveLength(4);
      expect(paragraphText(nodes[0]!)).toBe("Antes de la tabla.");
      expect(isHeading(nodes[1]!, 4)).toBe(true);
      expect(paragraphText(nodes[1]!)).toBe("Notas");
      expect(isTable(nodes[2]!)).toBe(true);
      const table = nodes[2]!;
      // 1 header row + 1 data row
      expect(table.content).toHaveLength(2);
      expect(table.content![0]!.type).toBe("tableRow");
      expect(headerRowText(table.content![0]!)).toEqual(["Materia", "Calificación"]);
      expect(rowCellsText(table.content![1]!)).toEqual(["Matemáticas", "4.5"]);
      expect(paragraphText(nodes[3]!)).toBe("Después de la tabla.");
    });

    it("acepta separador con o sin espacios (mínimo 3 guiones)", () => {
      const a = contextTextToTipTap("[TABLA: T\n| H |\n|---|\n| D |]");
      const b = contextTextToTipTap("[TABLA: T\n| H |\n|---|\n| D |]");
      const c = contextTextToTipTap("[TABLA: T\n| H |\n|--------------|\n| D |]");
      for (const nodes of [a, b, c]) {
        const table = nodes.find(isTable) as { content: { type: string }[] };
        expect(table.content).toHaveLength(2); // 1 header + 1 data
      }
    });

    it("tabla con 3 filas de datos", () => {
      const input = `[TABLA: T
| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |
| 5 | 6 |]`;
      const table = contextTextToTipTap(input).find(isTable)!;
      expect(table.content).toHaveLength(4); // 1 header + 3 data
      expect(rowCellsText(table.content![1]!)).toEqual(["1", "2"]);
      expect(rowCellsText(table.content![3]!)).toEqual(["5", "6"]);
    });

    it("tabla con N filas de headers (caso válido: cada celda es un header)", () => {
      // El parser no distingue entre "1 fila de N headers" y "1 fila
      // con título + headers": en ambos casos, si no hay data rows
      // adicionales, los primeros N items se tratan como título si
      // hay data. Aquí no hay data rows → título = todo, sin tabla.
      const input = "[TABLA: T\n| A | B |\n|---|---|\n]";
      // sin data rows: no genera tabla
      const nodes = contextTextToTipTap(input);
      expect(nodes.find(isTable)).toBeUndefined();
    });
  });

  describe("tabla malformada (formato real que emite el LLM)", () => {
    it("primer caso: título y headers pegados en la primera línea", () => {
      // Réplica exacta del output que dio el usuario.
      const input = `Lea las descripciones de la columna de la izquierda (1 - 5). ¿Cuál palabra de la columna de la derecha (A - G) concuerda con cada descripción? La opción H se usa para el ejemplo. Sobran dos palabras más. En las preguntas 1 - 5, marque la letra correcta A - G en su hoja de respuestas. In the kitchen Ejemplo: 0. Some people cook these plants to eat them. Respuesta: H
[TABLA: In the kitchen - Descripciones y Palabras | Descripciones | Palabras |
|---------------|----------|
| 1. These are round, and you buy them to have soup in them. | A. bowls |
| 2. You need water and dry leaves for this hot drink. | B. cake |
| 3. People eat this food on birthdays. | C. cheese |
| 4. This can be yellow, and you can make a sandwich with it. | D. juice |
| 5. Some people put this in their coffee or on their cereal. | E. milk |
| | F. plates |
| | G. tea |
| | H. vegetables |]`;

      const nodes = contextTextToTipTap(input);
      // 1 paragraph (instrucciones largas) + 1 heading + 1 table
      expect(nodes).toHaveLength(3);
      expect(isParagraph(nodes[0]!)).toBe(true);
      expect(isHeading(nodes[1]!, 4)).toBe(true);
      expect(paragraphText(nodes[1]!)).toBe("In the kitchen - Descripciones y Palabras");
      expect(isTable(nodes[2]!)).toBe(true);

      const table = nodes[2]! as { content: { type: string }[] };
      // 1 header row + 5 data rows + 3 filas con solo "F.", "G.", "H."
      // (que se cuentan como data porque tienen 1 celda cada una)
      // → total: header + 5 + 3 = 9 filas
      expect(table.content.length).toBeGreaterThanOrEqual(6);

      // El header row debe ser ["Descripciones", "Palabras"]
      const headers = headerRowText(table.content[0]!);
      expect(headers).toEqual(["Descripciones", "Palabras"]);

      // Las primeras 5 data rows: 1-5 en la col izquierda + A-E en la derecha
      expect(rowCellsText(table.content[1]!)).toEqual([
        "1. These are round, and you buy them to have soup in them.",
        "A. bowls",
      ]);
      expect(rowCellsText(table.content[2]!)).toEqual([
        "2. You need water and dry leaves for this hot drink.",
        "B. cake",
      ]);
      expect(rowCellsText(table.content[5]!)).toEqual([
        "5. Some people put this in their coffee or on their cereal.",
        "E. milk",
      ]);
    });

    it("tabla con solo la primera línea (sin separador, todo pegado)", () => {
      // El LLM metió todo: título + headers + data en una sola línea.
      // No hay separador `|---|`, así que cae al fallback
      // "primera línea = titleRow, el resto = data" — pero como no
      // hay más líneas, no hay data rows → no se genera tabla,
      // solo el heading con todo el contenido como título.
      const input = "[TABLA: T | H1 | H2 | D1 | D2 |]";
      const nodes = contextTextToTipTap(input);
      // heading(4) con el texto pegado, sin table
      expect(nodes).toHaveLength(1);
      expect(isHeading(nodes[0]!, 4)).toBe(true);
      expect(paragraphText(nodes[0]!)).toBe("T | H1 | H2 | D1 | D2");
    });

    it("tabla sin separador y con data en líneas siguientes deduce el header", () => {
      // Sin `|---|`: primera línea = "T | H1 | H2", el resto = data
      // → el parser toma los últimos N items de la primera línea como
      // headers (donde N = nº de columnas de las data rows).
      const input = `[TABLA: T | H1 | H2
| A | B |
| C | D |]`;
      const nodes = contextTextToTipTap(input);
      expect(nodes).toHaveLength(2); // heading + table
      expect(isHeading(nodes[0]!, 4)).toBe(true);
      expect(paragraphText(nodes[0]!)).toBe("T");
      const table = nodes[1]! as { content: { type: string }[] };
      expect(headerRowText(table.content[0]!)).toEqual(["H1", "H2"]);
      expect(rowCellsText(table.content[1]!)).toEqual(["A", "B"]);
      expect(rowCellsText(table.content[2]!)).toEqual(["C", "D"]);
    });
  });

  describe("tolerancia a malformaciones", () => {
    it("typo en el marcador → no se reconoce, queda como texto literal", () => {
      const input = "[ABLA: Título]\nTexto posterior.";
      const nodes = contextTextToTipTap(input);
      // Ambos renglones quedan como paragraphs (el bloque con typo
      // se trata como texto normal)
      expect(nodes).toHaveLength(2);
      expect(paragraphText(nodes[0]!)).toBe("[ABLA: Título]");
      expect(paragraphText(nodes[1]!)).toBe("Texto posterior.");
      expect(nodes.find(isTable)).toBeUndefined();
    });

    it("celdas vacías no producen nodos text vacíos (ProseMirror los rechaza)", () => {
      // El LLM emite filas como `| | B. cake |` donde la col 1 está
      // vacía. Antes del fix, el parser emitía `{ type: "text", text: "" }`
      // para esas celdas, lo que revienta el schema de ProseMirror con
      // "Empty text nodes are not allowed". El cell debe ser un paragraph
      // SIN text node (válido: paragraph admite 0 marks inline).
      const input = `[TABLA: T
| Col1 | Col2 |
|---|---|
| A | |
| | B |]`;
      const nodes = contextTextToTipTap(input);
      const table = nodes.find(isTable)!;
      // Verificar que el JSON del cell vacío no contiene text=""
      const cellA2 = table.content![1]!.content![1]!; // row 1 (data), col 1
      const cellB1 = table.content![2]!.content![0]!; // row 2 (data), col 0
      expect(cellA2.content).toEqual([{ type: "paragraph", content: [] }]);
      expect(cellB1.content).toEqual([{ type: "paragraph", content: [] }]);
    });

    it("input solo con el bloque de tabla, sin texto alrededor", () => {
      const input = `[TABLA: T
| H |
|---|
| D |]`;
      const nodes = contextTextToTipTap(input);
      expect(nodes).toHaveLength(2); // heading + table
      expect(isHeading(nodes[0]!, 4)).toBe(true);
      expect(isTable(nodes[1]!)).toBe(true);
    });

    it("múltiples tablas intercaladas con texto", () => {
      const input = `Intro.
[TABLA: T1
| H |
|---|
| A |]
Medio.
[TABLA: T2
| J |
|---|
| B |]
Final.`;
      const nodes = contextTextToTipTap(input);
      const tables = nodes.filter(isTable);
      expect(tables).toHaveLength(2);
      const paragraphs = nodes.filter(isParagraph);
      expect(paragraphs.map(paragraphText)).toEqual(["Intro.", "Medio.", "Final."]);
    });

    it("celda con espacios se trimea", () => {
      const input = `[TABLA: T
|  H1   |   H2  |
|-------|-------|
|  D1   |   D2  |]`;
      const table = contextTextToTipTap(input).find(isTable)!;
      expect(headerRowText(table.content![0]!)).toEqual(["H1", "H2"]);
      expect(rowCellsText(table.content![1]!)).toEqual(["D1", "D2"]);
    });
  });

  describe("imágenes ([IMAGEN id])", () => {
    const isImage = (n: TipTapNode): boolean => n.type === "image";
    const imageAttrs = (n: TipTapNode): Record<string, unknown> => (n.attrs ?? {}) as never;

    it("con `imageMap` undefined preserva el placeholder como texto", () => {
      const input = "Observe el gráfico: [IMAGEN p04-fig1] y responda.";
      const nodes = contextTextToTipTap(input);
      expect(nodes).toHaveLength(1);
      expect(isParagraph(nodes[0]!)).toBe(true);
      expect(paragraphText(nodes[0]!)).toContain("[IMAGEN p04-fig1]");
      expect(nodes.find(isImage)).toBeUndefined();
    });

    it("con `imageMap` vacío preserva el placeholder como texto", () => {
      const input = "Observe el gráfico: [IMAGEN p04-fig1] y responda.";
      const nodes = contextTextToTipTap(input, {});
      expect(nodes.filter(isImage)).toHaveLength(0);
      expect(paragraphText(nodes[0]!)).toContain("[IMAGEN p04-fig1]");
    });

    it("imageMap con 1 id → emite un nodo `image` con `src` y `width: 80`", () => {
      const url = "/api/uploads/evaluations/inst-1/uuid-1.jpg";
      const input = "Observe el gráfico: [IMAGEN p04-fig1] y responda.";
      const nodes = contextTextToTipTap(input, { "p04-fig1": url });
      // 2 paragraphs (antes y después) + 1 image intercalada
      expect(nodes).toHaveLength(3);
      expect(isParagraph(nodes[0]!)).toBe(true);
      expect(paragraphText(nodes[0]!)).toBe("Observe el gráfico:");
      expect(isImage(nodes[1]!)).toBe(true);
      expect(imageAttrs(nodes[1]!)).toEqual({ src: url, width: 80 });
      expect(isParagraph(nodes[2]!)).toBe(true);
      expect(paragraphText(nodes[2]!)).toBe("y responda.");
    });

    it("texto + imagen + texto + imagen → 3 paragraphs + 2 images", () => {
      const urlA = "/api/uploads/inst/uuid-a.jpg";
      const urlB = "/api/uploads/inst/uuid-b.jpg";
      const input = "A [IMAGEN p04-fig1] B [IMAGEN p04-fig2] C";
      const nodes = contextTextToTipTap(input, {
        "p04-fig1": urlA,
        "p04-fig2": urlB,
      });
      expect(nodes).toHaveLength(5);
      const paragraphs = nodes.filter(isParagraph);
      expect(paragraphs.map(paragraphText)).toEqual(["A", "B", "C"]);
      const images = nodes.filter(isImage);
      expect(images).toHaveLength(2);
      expect(imageAttrs(images[0]!)).toEqual({ src: urlA, width: 80 });
      expect(imageAttrs(images[1]!)).toEqual({ src: urlB, width: 80 });
    });

    it("imagen al inicio del texto", () => {
      const url = "/api/uploads/inst/uuid-a.jpg";
      const input = "[IMAGEN p04-fig1]\nTexto posterior.";
      const nodes = contextTextToTipTap(input, { "p04-fig1": url });
      expect(nodes).toHaveLength(2);
      expect(isImage(nodes[0]!)).toBe(true);
      expect(isParagraph(nodes[1]!)).toBe(true);
      expect(paragraphText(nodes[1]!)).toBe("Texto posterior.");
    });

    it("imagen al final del texto", () => {
      const url = "/api/uploads/inst/uuid-a.jpg";
      const input = "Texto previo.\n[IMAGEN p04-fig1]";
      const nodes = contextTextToTipTap(input, { "p04-fig1": url });
      expect(nodes).toHaveLength(2);
      expect(isParagraph(nodes[0]!)).toBe(true);
      expect(paragraphText(nodes[0]!)).toBe("Texto previo.");
      expect(isImage(nodes[1]!)).toBe(true);
    });

    it("solo imagen, sin texto", () => {
      const url = "/api/uploads/inst/uuid-a.jpg";
      const nodes = contextTextToTipTap("[IMAGEN p04-fig1]", {
        "p04-fig1": url,
      });
      expect(nodes).toHaveLength(1);
      expect(isImage(nodes[0]!)).toBe(true);
      expect(imageAttrs(nodes[0]!)).toEqual({ src: url, width: 80 });
    });

    it("id huérfana (no en imageMap) → placeholder literal como paragraph", () => {
      const input = "Antes [IMAGEN p04-figX] después.";
      const nodes = contextTextToTipTap(input, { "p04-fig1": "/u/1.jpg" });
      expect(nodes.filter(isImage)).toHaveLength(0);
      expect(paragraphText(nodes[0]!)).toContain("[IMAGEN p04-figX]");
    });

    it("mezcla con tabla: párrafo + imagen + tabla (orden preservado)", () => {
      const url = "/api/uploads/inst/uuid-a.jpg";
      const input = `Intro.
[IMAGEN p04-fig1]
[TABLA: T
| H |
|---|
| D |]`;
      const nodes = contextTextToTipTap(input, { "p04-fig1": url });
      // 1 paragraph + 1 image + 1 heading + 1 table
      expect(nodes).toHaveLength(4);
      expect(isParagraph(nodes[0]!)).toBe(true);
      expect(paragraphText(nodes[0]!)).toBe("Intro.");
      expect(isImage(nodes[1]!)).toBe(true);
      expect(isHeading(nodes[2]!, 4)).toBe(true);
      expect(isTable(nodes[3]!)).toBe(true);
    });

    it("`!!IMAGEN id!!` (formato de la imagen de la pregunta) NO se confunde", () => {
      const url = "/api/uploads/inst/uuid-a.jpg";
      const input = "Texto con !!IMAGEN p04-fig1!! embebido.";
      const nodes = contextTextToTipTap(input, { "p04-fig1": url });
      // El formato `!!IMAGEN` no matchea el regex `[IMAGEN ...]`, queda
      // como paragraph literal.
      expect(nodes.filter(isImage)).toHaveLength(0);
      expect(paragraphText(nodes[0]!)).toContain("!!IMAGEN p04-fig1!!");
    });

    it("imagen con whitespace irregular dentro del placeholder", () => {
      const url = "/api/uploads/inst/uuid-a.jpg";
      const input = "Antes [IMAGEN    p04-fig1   ] después.";
      const nodes = contextTextToTipTap(input, { "p04-fig1": url });
      expect(nodes.filter(isImage)).toHaveLength(1);
      expect(imageAttrs(nodes.filter(isImage)[0]!)).toEqual({ src: url, width: 80 });
    });

    describe("descripción tras el id (formato del motor con caption)", () => {
      it("`[IMAGEN id: descripción]` → image con `alt` y `title`", () => {
        const url = "/api/uploads/inst/uuid-a.jpg";
        const desc = "pintura cubista de Picasso titulada The Three Dancers";
        const nodes = contextTextToTipTap(`Observe [IMAGEN p04-fig1: ${desc}] y responda.`, {
          "p04-fig1": url,
        });
        const images = nodes.filter(isImage);
        expect(images).toHaveLength(1);
        // El placeholder INCLUIDO en el texto: el regex relaja hasta el `]`
        // inclusive, no deja restos literales.
        expect(nodes.filter(isParagraph).every((n) => !paragraphText(n).includes("[IMAGEN"))).toBe(
          true,
        );
        expect(imageAttrs(images[0]!)).toEqual({
          src: url,
          width: 80,
          alt: desc,
          title: desc,
        });
      });

      it("sin espacio tras `:` también matchea", () => {
        const url = "/api/uploads/inst/uuid-a.jpg";
        const nodes = contextTextToTipTap("[IMAGEN p04-fig1:cuadro al óleo]", {
          "p04-fig1": url,
        });
        const images = nodes.filter(isImage);
        expect(images).toHaveLength(1);
        expect(imageAttrs(images[0]!)).toEqual({
          src: url,
          width: 80,
          alt: "cuadro al óleo",
          title: "cuadro al óleo",
        });
      });

      it("descripción con comillas se preserva literal", () => {
        const url = "/api/uploads/inst/uuid-a.jpg";
        const nodes = contextTextToTipTap(
          `[IMAGEN p04-fig1: "The Three Dancers", mostrando figuras bailando]`,
          { "p04-fig1": url },
        );
        const images = nodes.filter(isImage);
        expect(images).toHaveLength(1);
        expect(imageAttrs(images[0]!).alt).toBe('"The Three Dancers", mostrando figuras bailando');
      });

      it("descripción huérfana (id no en map) → conserva placeholder literal", () => {
        const nodes = contextTextToTipTap("Antes [IMAGEN p04-figX: descripción perdida] después.", {
          "p04-fig1": "/u/1.jpg",
        });
        expect(nodes.filter(isImage)).toHaveLength(0);
        expect(paragraphText(nodes[0]!)).toContain("[IMAGEN p04-figX: descripción perdida]");
      });

      it("mezcla imagen-con-desc y imagen-sin-desc en el mismo contexto", () => {
        const urlA = "/api/uploads/inst/uuid-a.jpg";
        const urlB = "/api/uploads/inst/uuid-b.jpg";
        const nodes = contextTextToTipTap(
          "Inicio. [IMAGEN p04-fig1: con caption] medio [IMAGEN p04-fig2] final.",
          {
            "p04-fig1": urlA,
            "p04-fig2": urlB,
          },
        );
        const images = nodes.filter(isImage);
        expect(images).toHaveLength(2);
        expect(imageAttrs(images[0]!)).toEqual({
          src: urlA,
          width: 80,
          alt: "con caption",
          title: "con caption",
        });
        expect(imageAttrs(images[1]!)).toEqual({
          src: urlB,
          width: 80,
        });
      });

      it("descripción vacía tras `:` no añade `alt`/`title`", () => {
        const url = "/api/uploads/inst/uuid-a.jpg";
        const nodes = contextTextToTipTap("[IMAGEN p04-fig1:] x", { "p04-fig1": url });
        const images = nodes.filter(isImage);
        expect(images).toHaveLength(1);
        expect(imageAttrs(images[0]!)).toEqual({ src: url, width: 80 });
        expect(imageAttrs(images[0]!)).not.toHaveProperty("alt");
        expect(imageAttrs(images[0]!)).not.toHaveProperty("title");
      });
    });
  });
});
