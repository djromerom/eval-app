/**
 * Tests del tamaño de tablas: ancho de columna y alto de fila.
 *
 * Lo crítico es que ambos lleguen al HTML que renderiza el SERVIDOR para el
 * PDF. `prosemirror-tables` guarda el ancho en `colwidth`, que NO es un
 * atributo HTML real —el navegador lo ignora—, así que sin el puente a
 * `width` el docente ajustaría las columnas y el examen saldría impreso con
 * las de por defecto.
 */
import { describe, expect, it } from "vitest";
import { renderRichText } from "@/components/editor/render";

const cell = (text: string, attrs: Record<string, unknown> = {}) => ({
  type: "tableCell",
  attrs,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const tabla = (rows: { attrs?: Record<string, unknown>; cells: object[] }[]) => ({
  type: "doc",
  content: [
    {
      type: "table",
      content: rows.map((r) => ({
        type: "tableRow",
        ...(r.attrs ? { attrs: r.attrs } : {}),
        content: r.cells,
      })),
    },
  ],
});

describe("ancho de columna", () => {
  it("emite `width` además de `colwidth` (el navegador ignora colwidth)", () => {
    const html = renderRichText(tabla([{ cells: [cell("A", { colwidth: [220] })] }]));
    expect(html).toContain('width="220"');
    expect(html).toContain('colwidth="220"');
  });

  it("con celda combinada, el ancho es la suma de las columnas que abarca", () => {
    const html = renderRichText(tabla([{ cells: [cell("A", { colwidth: [120, 80] })] }]));
    expect(html).toContain('width="200"');
    expect(html).toContain('colwidth="120,80"');
  });

  it("una celda sin ancho no emite nada", () => {
    const html = renderRichText(tabla([{ cells: [cell("A")] }]));
    expect(html).not.toContain("width=");
    expect(html).not.toContain("colwidth=");
  });
});

describe("alto de fila", () => {
  it("emite `height` en el <tr>", () => {
    const html = renderRichText(tabla([{ attrs: { height: 76 }, cells: [cell("A")] }]));
    expect(html).toContain('<tr data-height="76" height="76">');
  });

  it("una fila sin alto queda automática", () => {
    const html = renderRichText(tabla([{ cells: [cell("A")] }]));
    expect(html).toContain("<tr>");
    expect(html).not.toContain("height=");
  });

  it("NUNCA usa `style` (el DOM del servidor lo descarta al sanitizar)", () => {
    const html = renderRichText(
      tabla([{ attrs: { height: 76 }, cells: [cell("A", { colwidth: [220] })] }]),
    );
    expect(html).not.toContain("style=");
  });
});
