/**
 * Agrupamiento de hojas por cuadernillo en el modo automático.
 */
import { describe, expect, it } from "vitest";
import {
  clasificarHojas,
  MOTIVOS,
  type LecturaDeHoja,
} from "@/modules/scanning/domain/clasificar-hojas";

const ok = (indice: number, bundleId: string): LecturaDeHoja => ({
  indice,
  nombre: `hoja_${indice}.tif`,
  bundleId,
  motivo: null,
});
const falla = (indice: number, motivo: LecturaDeHoja["motivo"]): LecturaDeHoja => ({
  indice,
  nombre: `hoja_${indice}.tif`,
  bundleId: null,
  motivo,
});

describe("clasificarHojas", () => {
  it("agrupa por cuadernillo", () => {
    const c = clasificarHojas([ok(0, "b1"), ok(1, "b2"), ok(2, "b1")]);
    expect(c.grupos).toEqual([
      { bundleId: "b1", indices: [0, 2] },
      { bundleId: "b2", indices: [1] },
    ]);
    expect(c.sinClasificar).toEqual([]);
  });

  it("ordena de mayor a menor, para que el lote principal quede primero", () => {
    const c = clasificarHojas([ok(0, "chico"), ok(1, "grande"), ok(2, "grande"), ok(3, "grande")]);
    expect(c.grupos.map((g) => g.bundleId)).toEqual(["grande", "chico"]);
  });

  it("separa las que no clasifican, con su motivo", () => {
    const c = clasificarHojas([ok(0, "b1"), falla(1, "firma-invalida"), falla(2, "qr-ilegible")]);
    expect(c.grupos).toHaveLength(1);
    expect(c.sinClasificar).toEqual([
      { indice: 1, nombre: "hoja_1.tif", motivo: "firma-invalida" },
      { indice: 2, nombre: "hoja_2.tif", motivo: "qr-ilegible" },
    ]);
  });

  it("una hoja sin bundleId nunca desaparece, aunque falte el motivo", () => {
    // Defensa contra un bug aguas arriba: perder la hoja en silencio seria
    // peor que reportarla con un motivo generico.
    const c = clasificarHojas([{ indice: 0, nombre: "x.tif", bundleId: null, motivo: null }]);
    expect(c.sinClasificar).toHaveLength(1);
    expect(c.sinClasificar[0]!.motivo).toBe("qr-ilegible");
  });

  it("conserva los indices originales, que son los que ubican el archivo", () => {
    const c = clasificarHojas([falla(0, "qr-ilegible"), ok(1, "b1"), ok(2, "b1")]);
    expect(c.grupos[0]!.indices).toEqual([1, 2]);
  });

  it("sin lecturas no crea grupos", () => {
    expect(clasificarHojas([])).toEqual({ grupos: [], sinClasificar: [] });
  });

  it("todos los motivos tienen texto legible", () => {
    for (const [clave, texto] of Object.entries(MOTIVOS)) {
      expect(texto.length, clave).toBeGreaterThan(10);
    }
  });
});
