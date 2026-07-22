import { describe, it, expect } from "vitest";
import { checkAlignment, MIN_SAMPLE } from "@/modules/scanning/domain/sheet-alignment";

/** Rejilla de burbujas de juguete: 20 filas × 4 opciones, paso 40 px. */
function grid() {
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < 20; r++) {
    for (let c = 0; c < 4; c++) out.push({ x: 100 + c * 40, y: 100 + r * 40 });
  }
  return out;
}

describe("sheet-alignment", () => {
  it("acepta una hoja cuyas marcas caen sobre la rejilla", () => {
    const centers = grid();
    // Una marca por fila, con jitter de ±3 px como en un escaneo real.
    const marks = centers
      .filter((_, i) => i % 4 === 1)
      .map((c, i) => ({ cx: c.x + (i % 2 ? 3 : -3), cy: c.y + 2 }));
    const res = checkAlignment({
      detectedMarks: marks,
      templateCenters: centers,
      bubbleDiameterPx: 34,
    });
    expect(res.ok).toBe(true);
    expect(res.matchRatio).toBe(1);
  });

  it("RECHAZA una hoja de otro formato — el caso que se coló en producción", () => {
    // Reproduce el fallo real: hoja impresa con reparto 40/40/30 leída con
    // una plantilla 37/37/36. El QR registra bien pero las burbujas no
    // coinciden; sin esta comprobación se guardaba 0/110 como GRADED.
    const centers = grid();
    const marks = centers
      .filter((_, i) => i % 4 === 1)
      .map((c) => ({ cx: c.x + 130, cy: c.y + 95 }));
    const res = checkAlignment({
      detectedMarks: marks,
      templateCenters: centers,
      bubbleDiameterPx: 34,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("no corresponde a la plantilla");
  });

  it("no bloquea una hoja casi en blanco (evidencia insuficiente)", () => {
    const res = checkAlignment({
      detectedMarks: [{ cx: 9999, cy: 9999 }],
      templateCenters: grid(),
      bubbleDiameterPx: 34,
    });
    expect(res.sampleSize).toBeLessThan(MIN_SAMPLE);
    expect(res.ok).toBe(true);
  });

  it("rechaza si la plantilla viene vacía", () => {
    const res = checkAlignment({
      detectedMarks: [{ cx: 1, cy: 1 }],
      templateCenters: [],
      bubbleDiameterPx: 34,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("plantilla sin burbujas");
  });

  it("marcas justo en el borde de la tolerancia siguen contando", () => {
    const centers = grid();
    // Desplazamiento de 16 px con tolerancia 17 (= diámetro 34 × 0.5).
    const marks = centers.filter((_, i) => i % 4 === 1).map((c) => ({ cx: c.x + 16, cy: c.y }));
    const res = checkAlignment({
      detectedMarks: marks,
      templateCenters: centers,
      bubbleDiameterPx: 34,
    });
    expect(res.ok).toBe(true);
  });
});
