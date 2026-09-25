/**
 * A qué lote va una hoja sin clasificar cuando alguien le elige cuadernillo.
 * Tiene que quedar en un lote de SU cuadernillo (el bloqueo de inhabilitar
 * preguntas y la matriz se leen por `ScanBatch.bundleId`), y en lo posible en
 * un lote de la misma carga.
 */
import { describe, expect, it } from "vitest";
import {
  elegirLoteDestino,
  type LoteParaDestino,
} from "@/modules/scanning/domain/unclassified-scan";

const t = (min: number) => new Date(Date.UTC(2026, 8, 24, 10, min));

const origen: LoteParaDestino = {
  id: "lote-origen",
  bundleId: "b-A",
  uploadedBy: "u-1",
  createdAt: t(0),
};

function lote(id: string, bundleId: string, min: number, uploadedBy = "u-1"): LoteParaDestino {
  return { id, bundleId, uploadedBy, createdAt: t(min) };
}

describe("elegirLoteDestino", () => {
  it("si el cuadernillo es el del lote de origen, va a ese lote", () => {
    expect(elegirLoteDestino(origen, "b-A", [lote("otro", "b-A", 1)])).toBe("lote-origen");
  });

  it("si no, va al lote hermano de ese cuadernillo", () => {
    expect(elegirLoteDestino(origen, "b-B", [lote("hermano", "b-B", 0)])).toBe("hermano");
  });

  it("entre varios, el más antiguo desde el origen", () => {
    const r = elegirLoteDestino(origen, "b-B", [
      lote("tarde", "b-B", 30),
      lote("pronto", "b-B", 1),
    ]);
    expect(r).toBe("pronto");
  });

  it("no cuenta un lote de otra persona", () => {
    expect(elegirLoteDestino(origen, "b-B", [lote("ajeno", "b-B", 1, "u-2")])).toBeNull();
  });

  it("no cuenta un lote anterior al origen", () => {
    expect(elegirLoteDestino(origen, "b-B", [lote("viejo", "b-B", -5)])).toBeNull();
  });

  it("no cuenta un lote de otro cuadernillo", () => {
    expect(elegirLoteDestino(origen, "b-B", [lote("otro", "b-C", 1)])).toBeNull();
  });

  it("desde un lote sin cuadernillo (ninguna hoja clasificó) va al lote de ese cuadernillo", () => {
    const sinCuadernillo = { ...origen, bundleId: null };
    expect(elegirLoteDestino(sinCuadernillo, "b-B", [lote("creado", "b-B", 2)])).toBe("creado");
    expect(elegirLoteDestino(sinCuadernillo, "b-B", [])).toBeNull();
  });

  it("sin candidatos devuelve null (hay que crear uno)", () => {
    expect(elegirLoteDestino(origen, "b-B", [])).toBeNull();
  });
});
